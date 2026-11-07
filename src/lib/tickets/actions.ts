"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str, bool } from "@/lib/utils";
import { filesFrom, validateFiles } from "@/lib/storage";
import { attachFiles } from "./files";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidateTicket(number: number) {
  revalidatePath(`/requests/${number}`);
  revalidatePath(`/desk/tickets/${number}`);
  revalidatePath("/requests");
  revalidatePath("/desk");
}

/** Reply (or internal note, for agents) with optional attachments. */
export async function postMessage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ticketId = str(fd, "ticket_id");
  const body = str(fd, "body");
  const internal = bool(fd, "internal");
  const files = filesFrom(fd);
  if (!ticketId || !UUID_RE.test(ticketId)) return fail("Ticket not found");
  if (!body && !files.length) return fail("Write a message or attach a file");
  if (body && body.length > 20000) return fail("Message is too long");
  try {
    await validateFiles(files);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid file");
  }

  const supabase = await createClient();
  const { data: ticket } = await supabase.from("tickets").select("id, number, team_id").eq("id", ticketId).maybeSingle();
  if (!ticket) return fail("Ticket not found");
  if (internal && !me.agentTeamIds.includes(ticket.team_id)) return fail("Only agents can add internal notes");

  const { data: msg, error } = await supabase
    .from("ticket_messages")
    .insert({ ticket_id: ticket.id, body: body ?? `Attached ${files.length} file${files.length === 1 ? "" : "s"}`, internal, author_id: me.id })
    .select("id")
    .single();
  if (error) return fail(dbError(error));

  const fileError = await attachFiles(ticket.id, files, msg.id);
  revalidateTicket(ticket.number);
  if (fileError) return fail(`Message sent, but the files failed: ${fileError}`);
  return ok(internal ? "Internal note added" : "Reply sent");
}

/** Requester: reopen a resolved ticket (within the reopen window) or close their own ticket. */
export async function setOwnTicketStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ticketId = str(fd, "ticket_id");
  const action = str(fd, "action");
  if (!ticketId || !UUID_RE.test(ticketId)) return fail("Ticket not found");
  if (action !== "reopen" && action !== "close") return fail("Unknown action");
  const reason = str(fd, "reason");

  const supabase = await createClient();
  const { data: ticket } = await supabase.from("tickets").select("id, number, requester_id, status").eq("id", ticketId).maybeSingle();
  if (!ticket || ticket.requester_id !== me.id) return fail("Ticket not found");

  if (action === "reopen") {
    if (!reason) return fail("Tell us what's still wrong");
    const { error } = await supabase.from("tickets").update({ status: "open" }).eq("id", ticket.id);
    if (error) return fail(dbError(error));
    const { error: msgErr } = await supabase.from("ticket_messages").insert({ ticket_id: ticket.id, body: `Reopened: ${reason}`, author_id: me.id });
    if (msgErr) return fail(`Reopened, but your note wasn't saved: ${dbError(msgErr)}`);
  } else {
    // Post the reason first: requesters can't add messages once a ticket is closed.
    if (reason) {
      const { error: msgErr } = await supabase.from("ticket_messages").insert({ ticket_id: ticket.id, body: `Closed by requester: ${reason}`, author_id: me.id });
      if (msgErr) return fail(dbError(msgErr));
    }
    const { error } = await supabase.from("tickets").update({ status: "closed" }).eq("id", ticket.id);
    if (error) return fail(dbError(error));
  }
  revalidateTicket(ticket.number);
  return ok(action === "reopen" ? "Ticket reopened" : "Ticket closed");
}

/** Requester: rate the resolution once. */
export async function rateTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const ticketId = str(fd, "ticket_id");
  const rating = str(fd, "rating");
  const comment = str(fd, "comment");
  if (!ticketId || !UUID_RE.test(ticketId)) return fail("Ticket not found");
  if (rating !== "good" && rating !== "bad") return fail("Choose a rating");
  if (comment && comment.length > 1000) return fail("Keep the comment under 1000 characters");
  const supabase = await createClient();
  const { data, error } = await supabase.from("tickets").update({ csat_rating: rating, csat_comment: comment }).eq("id", ticketId).select("number").maybeSingle();
  if (error) return fail(dbError(error));
  if (!data) return fail("Ticket not found");
  revalidateTicket(data.number);
  return ok("Thanks for the feedback!");
}
