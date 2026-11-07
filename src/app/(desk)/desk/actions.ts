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

  if (patch.team_id && !me.agentTeamIds.includes(patch.team_id)) {
    const error = await transferOut(ticket.id, patch);
    if (error) return fail(error);
  } else {
    // No .select(): after a transfer the viewer may no longer be able to read the ticket.
    const { error } = await supabase.from("tickets").update(patch).eq("id", ticket.id);
    if (error) return fail(dbError(error));
  }
  revalidateTicket(ticket.number);

  if (patch.team_id && !me.agentTeamIds.includes(patch.team_id)) {
    return ok(`${ticketRef(ticket.number)} was transferred`, "/desk");
  }
  return ok(patch.team_id ? "Ticket transferred" : "Changes saved");
}

/**
 * Transfer to a team the viewer isn't on. Row-level security checks the updated row against
 * the read rule, so a plain update fails once the ticket leaves the viewer's teams; the
 * `transfer_ticket` database function re-checks that the viewer is an agent of the current
 * team and performs the move (triggers still validate category/assignee and log it under the
 * viewer's name). Other field changes go through a normal update first.
 */
async function transferOut(ticketId: string, patch: TablesUpdate<{ schema: "servicedesk" }, "tickets">): Promise<string | null> {
  const { team_id, category_id, assignee_id, ...rest } = patch;
  const supabase = await createClient();
  if (Object.keys(rest).length) {
    const { error } = await supabase.from("tickets").update(rest).eq("id", ticketId);
    if (error) return dbError(error);
  }
  const { error } = await supabase.rpc("transfer_ticket", {
    p_ticket: ticketId,
    p_team: team_id!,
    p_category: category_id ?? undefined,
    p_assignee: assignee_id ?? undefined,
  });
  return error ? dbError(error) : null;
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

// ---------------------------------------------------------------------------
// Bulk actions (queue)
// ---------------------------------------------------------------------------

const BULK_MAX = 100;
const BULK_OPS = ["assign", "status", "priority", "incident"] as const;
type BulkOp = (typeof BULK_OPS)[number];

/** Queue bulk bar: assign / set status / set priority / link incident for many tickets. Every id is re-checked. */
export async function bulkUpdate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ids = [...new Set(fd.getAll("ids").filter((v): v is string => typeof v === "string"))];
  const op = str(fd, "op") as BulkOp | null;
  const value = str(fd, "value");
  const note = str(fd, "note");
  if (!ids.length) return fail("Select at least one ticket");
  if (ids.length > BULK_MAX) return fail(`Select up to ${BULK_MAX} tickets at a time`);
  if (!ids.every(isUuid)) return fail("Some selected tickets are invalid. Reload the page and try again.");
  if (!op || !BULK_OPS.includes(op)) return fail("Choose what to change");
  if (!value) return fail("Choose a value");
  if (note && note.length > 20000) return fail("Message is too long");

  const supabase = await createClient();
  const { data: rows, error: loadError } = await supabase
    .from("tickets")
    .select("id, number, team_id, status, priority, approval_status, assignee_id, incident_id")
    .in("id", ids);
  if (loadError) return fail(dbError(loadError));
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));

  // Validate the value once.
  let assignee: string | null = null;
  let memberTeams = new Set<string>();
  let incident: { id: string; team_id: string; title: string } | null = null;
  if (op === "assign") {
    assignee = value === "unassigned" ? null : value === "me" ? me.id : value;
    if (assignee !== null && !isUuid(assignee)) return fail("Choose a valid agent");
    if (assignee) {
      const { data: m } = await supabase.from("team_members").select("team_id").eq("employee_id", assignee);
      memberTeams = new Set((m ?? []).map((x) => x.team_id));
    }
  } else if (op === "status") {
    if (!isStatus(value) || value === "new") return fail("Choose a valid status");
    if ((value === "resolved" || value === "pending") && !note)
      return fail(value === "resolved" ? "Add a resolution note for the requesters" : "Write the question for the requesters");
  } else if (op === "priority") {
    if (!isPriority(value)) return fail("Choose a valid priority");
  } else if (op === "incident" && value !== "none") {
    if (!isUuid(value)) return fail("Choose a valid incident");
    const { data: inc } = await supabase.from("incidents").select("id, team_id, title, status").eq("id", value).maybeSingle();
    if (!inc) return fail("Incident not found");
    if (inc.status === "resolved") return fail("That incident is already resolved");
    incident = inc;
  }

  let updated = 0;
  let unchanged = 0;
  const reasons = new Map<string, number>();
  const failed = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  const touched: number[] = [];

  for (const id of ids) {
    const t = byId.get(id);
    if (!t || !me.agentTeamIds.includes(t.team_id)) {
      failed("not found or not your team's");
      continue;
    }
    let patch: TablesUpdate<{ schema: "servicedesk" }, "tickets"> | null = null;
    if (op === "assign") {
      if (t.assignee_id === assignee) {
        unchanged++;
        continue;
      }
      if (assignee && !memberTeams.has(t.team_id)) {
        failed("agent isn't on that ticket's team");
        continue;
      }
      patch = { assignee_id: assignee };
    } else if (op === "priority") {
      if (t.priority === value) {
        unchanged++;
        continue;
      }
      patch = { priority: value! };
    } else if (op === "incident") {
      const next = incident?.id ?? null;
      if (t.incident_id === next) {
        unchanged++;
        continue;
      }
      if (incident && incident.team_id !== t.team_id) {
        failed("incident belongs to another team");
        continue;
      }
      patch = { incident_id: next };
    } else {
      if (t.status === value) {
        unchanged++;
        continue;
      }
      if (t.approval_status === "pending") {
        failed("waiting for approval");
        continue;
      }
      if (value === "pending" && t.status !== "new" && t.status !== "open") {
        failed("only new or open tickets can be marked pending");
        continue;
      }
      if (value === "resolved" && t.status === "closed") {
        failed("already closed");
        continue;
      }
      if (note && (value === "resolved" || value === "pending")) {
        const { error } = await supabase.from("ticket_messages").insert({ ticket_id: t.id, body: note, internal: false, author_id: me.id });
        if (error) {
          failed(dbError(error));
          continue;
        }
      }
      patch = { status: value! };
    }
    const { error } = await supabase.from("tickets").update(patch).eq("id", t.id);
    if (error) failed(dbError(error));
    else {
      updated++;
      touched.push(t.number);
    }
  }

  for (const n of touched) revalidatePath(`/desk/tickets/${n}`);
  revalidatePath("/desk");
  revalidatePath("/requests");

  const failedCount = [...reasons.values()].reduce((a, b) => a + b, 0);
  const parts = [`Updated ${updated}`];
  if (unchanged) parts.push(`${unchanged} already set`);
  if (failedCount) parts.push(`failed ${failedCount} (${[...reasons].map(([r, n]) => (reasons.size > 1 ? `${n} ${r}` : r)).join("; ")})`);
  const message = parts.join(", ");
  return updated === 0 && failedCount > 0 ? fail(message) : ok(message);
}

// ---------------------------------------------------------------------------
// Ticket page helpers: templates, merge, incidents, followers
// ---------------------------------------------------------------------------

/** Count a reply template use (called by the Composer when one is inserted). */
export async function recordTemplateUse(id: string): Promise<void> {
  if (!isUuid(id)) return;
  const me = await getViewer();
  if (!me?.isAgent) return;
  const supabase = await createClient();
  await supabase.rpc("record_canned_use", { p_id: id });
}

export type TicketLookup = { ok: true; ticket: { id: string; number: number; subject: string; status: string; team: string | null } } | { ok: false; error: string };

/** "Merge into…" preview: find a ticket by number among the viewer's teams. */
export async function lookupTicket(input: string): Promise<TicketLookup> {
  const me = await getViewer();
  if (!me?.isAgent) return { ok: false, error: "Not signed in" };
  const m = /^\s*(?:sd-?)?(\d{1,9})\s*$/i.exec(input ?? "");
  if (!m) return { ok: false, error: "Enter a ticket number, like SD-1042" };
  const supabase = await createClient();
  const { data } = await supabase.from("tickets").select("id, number, subject, status, team_id, team:teams(name)").eq("number", Number(m[1])).maybeSingle();
  if (!data || !me.agentTeamIds.includes(data.team_id)) return { ok: false, error: `${ticketRef(m[1])} wasn't found in your teams` };
  const team = data.team as unknown as { name: string } | null;
  return { ok: true, ticket: { id: data.id, number: data.number, subject: data.subject, status: data.status, team: team?.name ?? null } };
}

export async function mergeTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const source = await agentTicket(me, str(fd, "ticket_id"));
  const target = await agentTicket(me, str(fd, "target_id"));
  if (!source || !target) return fail("Ticket not found");
  if (source.id === target.id) return fail("Choose a different ticket to merge into");
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_tickets", { p_source: source.id, p_target: target.id });
  if (error) return fail(dbError(error));
  revalidateTicket(source.number);
  revalidateTicket(target.number);
  return ok(`${ticketRef(source.number)} merged into ${ticketRef(target.number)}`, `/desk/tickets/${target.number}`);
}

/** Link the ticket to an active incident of its team, or unlink it (empty incident_id). */
export async function setIncident(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ticket = await agentTicket(me, str(fd, "ticket_id"));
  if (!ticket) return fail("Ticket not found");
  const incidentId = str(fd, "incident_id");
  if (incidentId !== null && !isUuid(incidentId)) return fail("Choose a valid incident");
  const supabase = await createClient();
  if (incidentId) {
    const { data: inc } = await supabase.from("incidents").select("team_id, status").eq("id", incidentId).maybeSingle();
    if (!inc || inc.team_id !== ticket.team_id) return fail("Choose an incident of this ticket's team");
    if (inc.status === "resolved") return fail("That incident is already resolved");
  }
  const { error } = await supabase.from("tickets").update({ incident_id: incidentId }).eq("id", ticket.id);
  if (error) return fail(dbError(error));
  revalidateTicket(ticket.number);
  return ok(incidentId ? "Linked to the incident" : "Unlinked from the incident");
}

export async function addFollower(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ticket = await agentTicket(me, str(fd, "ticket_id"));
  if (!ticket) return fail("Ticket not found");
  const employeeId = str(fd, "employee_id");
  if (!isUuid(employeeId)) return fail("Choose a colleague");
  const supabase = await createClient();
  const { error } = await supabase.from("ticket_followers").insert({ ticket_id: ticket.id, employee_id: employeeId, added_by: me.id });
  if (error) return fail(error.code === "23505" ? "They're already following this ticket" : dbError(error));
  revalidateTicket(ticket.number);
  return ok("Follower added");
}

export async function removeFollower(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ticket = await agentTicket(me, str(fd, "ticket_id"));
  if (!ticket) return fail("Ticket not found");
  const employeeId = str(fd, "employee_id");
  if (!isUuid(employeeId)) return fail("Follower not found");
  const supabase = await createClient();
  const { error, count } = await supabase.from("ticket_followers").delete({ count: "exact" }).eq("ticket_id", ticket.id).eq("employee_id", employeeId);
  if (error) return fail(dbError(error));
  if (!count) return fail("They're no longer following this ticket");
  revalidateTicket(ticket.number);
  return ok("Follower removed");
}

export type PersonHit = { id: string; full_name: string | null; email: string; department: string | null };

/** People picker search (agents only): active employees by name or email. */
export async function searchPeople(q: string): Promise<PersonHit[]> {
  const me = await getViewer();
  if (!me?.isAgent) return [];
  const term = (q ?? "").replace(/[%_*\\"(),.:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (term.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("people")
    .select("id, full_name, email, department")
    .neq("status", "exited")
    .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
    .order("full_name")
    .limit(8);
  return (data ?? []) as PersonHit[];
}
