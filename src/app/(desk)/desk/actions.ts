"use server";

import { revalidatePath } from "next/cache";
import { getViewer, type Viewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str, bool } from "@/lib/utils";
import { isPriority, isStatus, ticketRef } from "@/lib/constants";
import { filesFrom, validateFiles } from "@/lib/storage";
import { attachFiles } from "@/lib/tickets/files";
import type { TablesUpdate } from "@/lib/database.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null): v is string => !!v && UUID_RE.test(v);

function revalidateTicket(number: number) {
  revalidatePath(`/desk/tickets/${number}`);
  revalidatePath(`/requests/${number}`);
  revalidatePath("/requests");
  revalidatePath("/desk");
}

/** Loads a ticket the viewer works as an agent (RLS + team check). */
async function agentTicket(me: Viewer, ticketId: string | null) {
  if (!isUuid(ticketId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("tickets")
    .select("id, number, team_id, status, priority, category_id, assignee_id, asset_id, approval_status")
    .eq("id", ticketId)
    .maybeSingle();
  if (!data || !me.agentTeamIds.includes(data.team_id)) return null;
  return data;
}

const isMember = (me: Viewer, teamId: string) => me.memberships.some((m) => m.teamId === teamId);

/** "Take it" / "Assign to me". */
export async function assignToMe(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ticket = await agentTicket(me, str(fd, "ticket_id"));
  if (!ticket) return fail("Ticket not found");
  if (!isMember(me, ticket.team_id)) return fail("Join this team first to take its tickets");
  if (ticket.assignee_id === me.id) return ok("It's already yours");
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").update({ assignee_id: me.id }).eq("id", ticket.id);
  if (error) return fail(dbError(error));
  revalidateTicket(ticket.number);
  return ok(`${ticketRef(ticket.number)} is now yours`);
}

/** Sidebar "Properties": status, priority, team (transfer), category, assignee, linked asset. */
export async function updateTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ticket = await agentTicket(me, str(fd, "ticket_id"));
  if (!ticket) return fail("Ticket not found");

  const status = str(fd, "status");
  const priority = str(fd, "priority");
  const teamId = str(fd, "team_id");
  const categoryId = str(fd, "category_id");
  const assigneeId = str(fd, "assignee_id");
  const hasAsset = fd.has("asset_id");
  const assetId = str(fd, "asset_id");

  if (status !== null && !isStatus(status)) return fail("Choose a valid status");
  if (priority !== null && !isPriority(priority)) return fail("Choose a valid priority");
  if (teamId !== null && !isUuid(teamId)) return fail("Choose a valid team");
  if (categoryId !== null && !isUuid(categoryId)) return fail("Choose a valid category");
  if (assigneeId !== null && !isUuid(assigneeId)) return fail("Choose a valid assignee");
  if (assetId !== null && !isUuid(assetId)) return fail("Choose a valid asset");

  const supabase = await createClient();
  const targetTeam = teamId ?? ticket.team_id;
  const patch: TablesUpdate<{ schema: "servicedesk" }, "tickets"> = {};

  if (targetTeam !== ticket.team_id) {
    const { data: team } = await supabase.from("teams").select("id, active").eq("id", targetTeam).maybeSingle();
    if (!team || !team.active) return fail("That team is not accepting tickets");
    patch.team_id = targetTeam;
  }
  if (status && status !== ticket.status) {
    if (ticket.approval_status === "pending") return fail("This request is waiting for approval");
    patch.status = status;
  }
  if (priority && priority !== ticket.priority) patch.priority = priority;
  if (categoryId !== ticket.category_id) {
    if (categoryId) {
      const { data: cat } = await supabase.from("categories").select("team_id").eq("id", categoryId).maybeSingle();
      if (!cat || cat.team_id !== targetTeam) return fail("That category belongs to another team");
    }
    patch.category_id = categoryId;
  }
  if (assigneeId !== ticket.assignee_id) {
    if (assigneeId) {
      const { data: member } = await supabase.from("team_members").select("employee_id").eq("team_id", targetTeam).eq("employee_id", assigneeId).maybeSingle();
      if (!member) return fail("The assignee is not on this team");
    }
    patch.assignee_id = assigneeId;
  }
  if (hasAsset && assetId !== ticket.asset_id) {
    if (assetId) {
      const { data: asset } = await supabase.from("assets").select("id").eq("id", assetId).maybeSingle();
      if (!asset) return fail("Asset not found");
    }
    patch.asset_id = assetId;
  }

  if (!Object.keys(patch).length) return ok("Nothing to change");

  // No .select(): after a transfer the viewer may no longer be able to read the ticket.
  const { error } = await supabase.from("tickets").update(patch).eq("id", ticket.id);
  if (error) return fail(dbError(error));
  revalidateTicket(ticket.number);

  if (patch.team_id && !me.agentTeamIds.includes(patch.team_id)) {
    return ok(`${ticketRef(ticket.number)} was transferred`, "/desk");
  }
  return ok(patch.team_id ? "Ticket transferred" : "Changes saved");
}

/** Shared by "Resolve" and "Mark pending": post a public reply, then change status. */
async function replyAndSetStatus(fd: FormData, target: "resolved" | "pending"): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ticket = await agentTicket(me, str(fd, "ticket_id"));
  if (!ticket) return fail("Ticket not found");
  const body = str(fd, "remarks");
  if (!body) return fail(target === "resolved" ? "Add a resolution note for the requester" : "Write the question for the requester");
  if (body.length > 20000) return fail("Message is too long");
  if (ticket.approval_status === "pending") return fail("This request is waiting for approval");
  if (target === "resolved" && ["resolved", "closed"].includes(ticket.status)) return fail("This ticket is already resolved");
  if (target === "pending" && ticket.status !== "new" && ticket.status !== "open") return fail("Only new or open tickets can be marked pending");

  const supabase = await createClient();
  const { error: msgError } = await supabase.from("ticket_messages").insert({ ticket_id: ticket.id, body, internal: false, author_id: me.id });
  if (msgError) return fail(dbError(msgError));
  const { error } = await supabase.from("tickets").update({ status: target }).eq("id", ticket.id);
  revalidateTicket(ticket.number);
  if (error) return fail(`Your reply was sent, but the status didn't change: ${dbError(error)}`);
  return ok(target === "resolved" ? "Ticket resolved" : "Marked as waiting on the requester");
}

export async function resolveTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return replyAndSetStatus(fd, "resolved");
}

export async function markPending(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return replyAndSetStatus(fd, "pending");
}

/** /desk/new: raise a ticket on behalf of an employee. */
export async function createTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const requesterId = str(fd, "requester_id");
  const teamId = str(fd, "team_id");
  const categoryId = str(fd, "category_id");
  const priority = str(fd, "priority") ?? "medium";
  const status = str(fd, "status") ?? "new";
  const subject = str(fd, "subject");
  const description = str(fd, "description");
  const assignToMe = bool(fd, "assign_to_me");
  let assigneeId = str(fd, "assignee_id");
  const files = filesFrom(fd);

  if (!isUuid(requesterId)) return fail("Choose who this ticket is for");
  if (!isUuid(teamId) || !me.agentTeamIds.includes(teamId)) return fail("Choose one of your teams");
  if (categoryId !== null && !isUuid(categoryId)) return fail("Choose a valid category");
  if (!isPriority(priority)) return fail("Choose a valid priority");
  if (status !== "new" && status !== "open") return fail("Choose a valid status");
  if (!subject || subject.length < 3) return fail("Add a subject (at least 3 characters)");
  if (subject.length > 200) return fail("Keep the subject under 200 characters");
  if (!description) return fail("Describe the problem or request");
  if (description.length > 20000) return fail("Description is too long");
  if (assignToMe) {
    if (!isMember(me, teamId)) return fail("You're not on this team, so you can't assign it to yourself");
    assigneeId = me.id;
  }
  if (assigneeId !== null && !isUuid(assigneeId)) return fail("Choose a valid assignee");
  try {
    await validateFiles(files);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid file");
  }

  const supabase = await createClient();
  const [{ data: requester }, { data: category }] = await Promise.all([
    supabase.from("people").select("id, status").eq("id", requesterId).maybeSingle(),
    categoryId ? supabase.from("categories").select("team_id").eq("id", categoryId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!requester || requester.status === "exited") return fail("That employee can't raise tickets");
  if (categoryId && (!category || category.team_id !== teamId)) return fail("That category belongs to another team");

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      requester_id: requesterId,
      team_id: teamId,
      category_id: categoryId,
      priority,
      status,
      subject,
      description,
      assignee_id: assigneeId,
      type: "incident",
    })
    .select("id, number")
    .single();
  if (error) return fail(dbError(error));

  const fileError = await attachFiles(ticket.id, files, null);
  revalidatePath("/desk");
  revalidatePath("/requests");
  const href = `/desk/tickets/${ticket.number}`;
  if (fileError) return ok(`${ticketRef(ticket.number)} created, but the files failed: ${fileError}`, href);
  return ok(`${ticketRef(ticket.number)} created`, href);
}
