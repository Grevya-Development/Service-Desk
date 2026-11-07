"use server";

import { revalidatePath } from "next/cache";
import { getViewer, type Viewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { ticketRef } from "@/lib/constants";
import { bool, str } from "@/lib/utils";
import { INCIDENT_STATUS_META, UPDATE_STATUSES, UUID_RE, isSeverity } from "../../status/_lib/incident";

type Supa = Awaited<ReturnType<typeof createClient>>;

function refresh(id?: string) {
  revalidatePath("/desk/incidents");
  revalidatePath("/status");
  revalidatePath("/home");
  if (id) revalidatePath(`/desk/incidents/${id}`);
}

/** Trimmed text with browser CRLF line endings normalised to "\n". */
function text(fd: FormData, key: string) {
  return str(fd, key)?.replace(/\r\n?/g, "\n") ?? null;
}

function readDetails(fd: FormData) {
  const title = str(fd, "title");
  const summary = text(fd, "summary");
  const severity = str(fd, "severity") ?? "major";
  if (!title || title.length < 3) return { error: "Give the incident a short title (at least 3 characters)." };
  if (title.length > 120) return { error: "Keep the title under 120 characters." };
  if (!summary || summary.length < 3) return { error: "Tell people what's affected (at least 3 characters)." };
  if (summary.length > 2000) return { error: "Keep the message under 2,000 characters." };
  if (!isSeverity(severity)) return { error: "Choose how serious it is." };
  return { title, summary, severity };
}

/** Loads an incident the viewer can manage, or returns an error message. */
async function loadManageable(supabase: Supa, me: Viewer, id: string | null) {
  if (!id || !UUID_RE.test(id)) return { error: "We couldn't find that incident." } as const;
  const { data } = await supabase.from("incidents").select("id, team_id, title, status").eq("id", id).maybeSingle();
  if (!data) return { error: "We couldn't find that incident. It may have been deleted." } as const;
  if (!me.agentTeamIds.includes(data.team_id)) return { error: "Only agents of this incident's team can change it." } as const;
  return { incident: data } as const;
}

export async function declareIncident(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const teamId = str(fd, "team_id");
  if (!teamId || !UUID_RE.test(teamId) || !me.agentTeamIds.includes(teamId)) return fail("Choose one of your teams.");
  const d = readDetails(fd);
  if ("error" in d) return fail(d.error!);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incidents")
    .insert({ team_id: teamId, title: d.title, summary: d.summary, severity: d.severity, created_by: me.id })
    .select("id")
    .single();
  if (error || !data) return fail(dbError(error, "We couldn't declare the incident. Please try again."));
  refresh(data.id);
  return ok("Incident declared. It's now on the Service status page.", `/desk/incidents/${data.id}`);
}

export async function editIncident(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const supabase = await createClient();
  const found = await loadManageable(supabase, me, str(fd, "id"));
  if ("error" in found) return fail(found.error!);
  const d = readDetails(fd);
  if ("error" in d) return fail(d.error!);

  const { error } = await supabase.from("incidents").update({ title: d.title, summary: d.summary, severity: d.severity }).eq("id", found.incident.id);
  if (error) return fail(dbError(error));
  refresh(found.incident.id);
  return ok("Changes saved");
}

export async function postIncidentUpdate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const supabase = await createClient();
  const found = await loadManageable(supabase, me, str(fd, "id"));
  if ("error" in found) return fail(found.error!);
  const status = str(fd, "status");
  if (!status || !(UPDATE_STATUSES as readonly string[]).includes(status)) return fail("Choose where things stand.");
  const body = text(fd, "body");
  if (!body) return fail("Write a short message for the people affected.");
  if (body.length > 2000) return fail("Keep the message under 2,000 characters.");

  const { error } = await supabase.from("incident_updates").insert({ incident_id: found.incident.id, status, body, author_id: me.id });
  if (error) return fail(dbError(error));
  refresh(found.incident.id);
  const reopened = found.incident.status === "resolved";
  return ok(reopened ? "Incident reopened and update posted" : `Update posted · ${INCIDENT_STATUS_META[status as (typeof UPDATE_STATUSES)[number]].label}`);
}

export async function resolveIncident(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const supabase = await createClient();
  const found = await loadManageable(supabase, me, str(fd, "id"));
  if ("error" in found) return fail(found.error!);
  if (found.incident.status === "resolved") return fail("This incident is already resolved.");
  const message = text(fd, "message");
  if (!message) return fail("Tell people what was fixed.");
  if (message.length > 2000) return fail("Keep the message under 2,000 characters.");
  const alsoTickets = bool(fd, "resolve_tickets");

  const { data, error } = await supabase.rpc("resolve_incident", { p_id: found.incident.id, p_message: message, p_resolve_tickets: alsoTickets });
  if (error) return fail(dbError(error, "We couldn't resolve the incident. Please try again."));
  refresh(found.incident.id);
  revalidatePath("/desk");
  const n = data ?? 0;
  return ok(alsoTickets && n > 0 ? `Incident resolved. ${n} linked ${n === 1 ? "ticket was" : "tickets were"} resolved too.` : "Incident resolved");
}

export async function deleteIncident(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const supabase = await createClient();
  const found = await loadManageable(supabase, me, str(fd, "id"));
  if ("error" in found) return fail(found.error!);
  if (!me.leadTeamIds.includes(found.incident.team_id)) return fail("Only team leads can delete an incident.");

  const { data, error } = await supabase.from("incidents").delete().eq("id", found.incident.id).select("id");
  if (error) return fail(dbError(error));
  if (!data?.length) return fail("You don't have permission to delete this incident.");
  refresh();
  return ok("Incident deleted", "/desk/incidents");
}

/** Accepts "SD-1104, 1105 1106" → [1104, 1105, 1106]. */
function parseTicketNumbers(raw: string) {
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  const numbers: number[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    const m = /^(?:sd-?)?#?(\d{1,9})$/i.exec(p);
    if (m) numbers.push(Number(m[1]));
    else invalid.push(p);
  }
  return { numbers: [...new Set(numbers)], invalid };
}

export async function linkTickets(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const supabase = await createClient();
  const found = await loadManageable(supabase, me, str(fd, "id"));
  if ("error" in found) return fail(found.error!);
  const raw = str(fd, "numbers");
  if (!raw) return fail("Enter one or more ticket numbers, e.g. SD-1104, SD-1105.");
  const { numbers, invalid } = parseTicketNumbers(raw);
  if (invalid.length) return fail(`“${invalid.slice(0, 3).join("”, “")}” ${invalid.length === 1 ? "isn't a ticket number" : "aren't ticket numbers"}. Use numbers like SD-1104.`);
  if (!numbers.length) return fail("Enter one or more ticket numbers, e.g. SD-1104.");
  if (numbers.length > 50) return fail("Link up to 50 tickets at a time.");

  const { data: rows, error: readError } = await supabase.from("tickets").select("id, number, team_id, incident_id").in("number", numbers);
  if (readError) return fail(dbError(readError));
  const byNumber = new Map((rows ?? []).map((t) => [t.number, t]));
  const missing = numbers.filter((n) => !byNumber.has(n));
  const notMine = (rows ?? []).filter((t) => !me.agentTeamIds.includes(t.team_id)).map((t) => t.number);
  const already = (rows ?? []).filter((t) => t.incident_id === found.incident.id).map((t) => t.number);
  const toLink = (rows ?? []).filter((t) => me.agentTeamIds.includes(t.team_id) && t.incident_id !== found.incident.id);

  if (toLink.length) {
    const { data: updated, error } = await supabase
      .from("tickets")
      .update({ incident_id: found.incident.id })
      .in(
        "id",
        toLink.map((t) => t.id),
      )
      .select("id");
    if (error) return fail(dbError(error));
    if ((updated?.length ?? 0) < toLink.length) return fail("Some tickets couldn't be linked. You may not have permission to change them.");
  }

  const refs = (ns: number[]) => ns.map(ticketRef).join(", ");
  const problems = [
    missing.length && `${refs(missing)} not found`,
    notMine.length && `${refs(notMine)} belong${notMine.length === 1 ? "s" : ""} to another team`,
  ].filter(Boolean);
  if (!toLink.length) {
    if (already.length && !problems.length) return fail(`${refs(already)} ${already.length === 1 ? "is" : "are"} already linked.`);
    return fail(problems.join(" · ") || "Nothing to link.");
  }
  refresh(found.incident.id);
  const moved = toLink.filter((t) => t.incident_id).length;
  const msg = `Linked ${toLink.length} ${toLink.length === 1 ? "ticket" : "tickets"}${moved ? ` (${moved} moved from another incident)` : ""}`;
  return ok(problems.length ? `${msg}. ${problems.join(" · ")}.` : msg);
}

export async function unlinkTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const supabase = await createClient();
  const found = await loadManageable(supabase, me, str(fd, "id"));
  if ("error" in found) return fail(found.error!);
  const ticketId = str(fd, "ticket_id");
  if (!ticketId || !UUID_RE.test(ticketId)) return fail("We couldn't find that ticket.");

  const { data, error } = await supabase.from("tickets").update({ incident_id: null }).eq("id", ticketId).eq("incident_id", found.incident.id).select("number");
  if (error) return fail(dbError(error));
  if (!data?.length) return fail("That ticket isn't linked any more, or you can't change it.");
  refresh(found.incident.id);
  return ok(`${ticketRef(data[0].number)} unlinked`);
}
