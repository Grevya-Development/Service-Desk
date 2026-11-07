"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str } from "@/lib/utils";
import { isPriority, ticketRef } from "@/lib/constants";
import { filesFrom, validateFiles } from "@/lib/storage";
import { attachFiles } from "@/lib/tickets/files";
import { UUID_RE, sanitizeSearch } from "./_lib/query";

/** "Report an issue": the signed-in employee raises an incident for themselves. */
export async function createRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("You're not signed in. Please sign in again.");

  const teamId = str(fd, "team_id");
  const categoryId = str(fd, "category_id");
  const subject = str(fd, "subject");
  const description = str(fd, "description");
  const priority = str(fd, "priority") ?? "medium";
  const assetId = str(fd, "asset_id");

  if (!teamId || !UUID_RE.test(teamId)) return fail("Choose who can help you");
  if (categoryId && !UUID_RE.test(categoryId)) return fail("Choose a topic from the list");
  if (assetId && !UUID_RE.test(assetId)) return fail("Choose a device from the list");
  if (!subject || subject.length < 3) return fail("Add a short summary (at least 3 characters)");
  if (subject.length > 200) return fail("Keep the summary under 200 characters");
  if (!description) return fail("Describe what's happening");
  if (description.length > 20000) return fail("The description is too long (20,000 characters max)");
  if (!isPriority(priority)) return fail("Choose how urgent this is");

  const files = filesFrom(fd);
  try {
    await validateFiles(files);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "One of the files can't be attached");
  }

  const supabase = await createClient();
  const [{ data: team }, { data: categories }, { data: asset }] = await Promise.all([
    supabase.from("teams").select("id, active").eq("id", teamId).maybeSingle(),
    supabase.from("categories").select("id").eq("team_id", teamId).eq("active", true),
    assetId ? supabase.from("assets").select("id, assigned_to").eq("id", assetId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!team || !team.active) return fail("That team isn't taking requests right now. Please choose another.");
  const activeCategories = categories ?? [];
  if (categoryId && !activeCategories.some((c) => c.id === categoryId)) return fail("That topic isn't available. Please choose another.");
  if (!categoryId && activeCategories.length) return fail("Choose what this is about");
  if (assetId && (!asset || asset.assigned_to !== me.id)) return fail("You can only pick a device that's assigned to you");

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      requester_id: me.id,
      team_id: teamId,
      category_id: categoryId,
      subject,
      description,
      priority,
      asset_id: assetId,
      type: "incident",
    })
    .select("id, number")
    .single();
  if (error || !ticket) return fail(dbError(error, "We couldn't raise your request. Please try again."));

  const fileError = await attachFiles(ticket.id, files, null);
  revalidatePath("/requests");
  revalidatePath("/home");
  const ref = ticketRef(ticket.number);
  if (fileError) return ok(`${ref} raised, but your files couldn't be attached (${fileError}). You can add them in a reply.`, `/requests/${ticket.number}`);
  return ok(`${ref} raised. We'll keep you posted here.`, `/requests/${ticket.number}`);
}

// ---------------------------------------------------------------------------
// Followers (CC)
// ---------------------------------------------------------------------------

export type PersonHit = { id: string; full_name: string | null; email: string; department: string | null; designation: string | null; avatar_url: string | null };

/** Active colleagues matching a name or email, for the "add people" picker. */
export async function searchPeople(query: string): Promise<PersonHit[]> {
  const me = await getViewer();
  if (!me || typeof query !== "string") return [];
  const safe = sanitizeSearch(query, 60);
  if (safe.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("people")
    .select("id, full_name, email, department, designation, avatar_url")
    .neq("status", "exited")
    .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`)
    .order("full_name")
    .limit(8);
  return (data ?? []) as PersonHit[];
}

/** Turn follower trigger / RLS errors into plain words. */
function followerError(error: { message: string; code?: string }, action: "add" | "remove") {
  if (error.code === "23505") return "They're already following this request.";
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return action === "add" ? "Only the person who raised this request can add people." : "You can't remove this person.";
  }
  if (/requester already/i.test(error.message)) return "The requester already gets every update.";
  if (/active employee/i.test(error.message)) return "Choose someone who still works here.";
  if (/at most 20/i.test(error.message)) return "A request can have up to 20 followers. Remove someone first.";
  return dbError(error);
}

async function followerContext(fd: FormData) {
  const ticketId = str(fd, "ticket_id");
  const employeeId = str(fd, "employee_id");
  if (!ticketId || !UUID_RE.test(ticketId)) return { error: "Request not found" } as const;
  if (!employeeId || !UUID_RE.test(employeeId)) return { error: "Choose a person from the list" } as const;
  const supabase = await createClient();
  const { data: ticket } = await supabase.from("tickets").select("id, number, requester_id, status").eq("id", ticketId).maybeSingle();
  if (!ticket) return { error: "Request not found" } as const;
  return { supabase, ticket, employeeId } as const;
}

/** Requester adds a colleague who should get updates and be able to reply. */
export async function addFollower(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("You're not signed in. Please sign in again.");
  const ctx = await followerContext(fd);
  if ("error" in ctx) return fail(ctx.error ?? "Request not found");
  const { supabase, ticket, employeeId } = ctx;
  if (ticket.requester_id !== me.id && !me.agentTeamIds.length) return fail("Only the person who raised this request can add people.");
  if (employeeId === ticket.requester_id) return fail(employeeId === me.id ? "You raised this request, so you already get every update." : "The requester already gets every update.");
  if (ticket.status === "closed") return fail("This request is closed, so there's nothing new to follow.");

  const { error } = await supabase.from("ticket_followers").insert({ ticket_id: ticket.id, employee_id: employeeId, added_by: me.id });
  if (error) return fail(followerError(error, "add"));
  const { data: person } = await supabase.from("people").select("full_name").eq("id", employeeId).maybeSingle();
  revalidatePath(`/requests/${ticket.number}`);
  revalidatePath(`/desk/tickets/${ticket.number}`);
  return ok(`${person?.full_name ?? "They"} will now get updates on ${ticketRef(ticket.number)}`);
}

/** Requester removes a follower, or a follower stops following. */
export async function removeFollower(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("You're not signed in. Please sign in again.");
  const ctx = await followerContext(fd);
  if ("error" in ctx) return fail(ctx.error ?? "Request not found");
  const { supabase, ticket, employeeId } = ctx;
  const self = employeeId === me.id;
  if (!self && ticket.requester_id !== me.id && !me.agentTeamIds.length) return fail("You can't remove this person.");

  const { data, error } = await supabase.from("ticket_followers").delete().eq("ticket_id", ticket.id).eq("employee_id", employeeId).select("employee_id");
  if (error) return fail(followerError(error, "remove"));
  if (!data?.length) return fail(self ? "You're not following this request." : "They're no longer following this request.");
  revalidatePath(`/requests/${ticket.number}`);
  revalidatePath(`/desk/tickets/${ticket.number}`);
  revalidatePath("/requests");
  // A follower who stops following can no longer open the request.
  if (self) return ok(`You've stopped following ${ticketRef(ticket.number)}`, "/requests?tab=following");
  return ok("Removed. They won't get updates any more.");
}
