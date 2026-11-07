import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/storage";
import type { Tables } from "@/lib/database.types";

export type Person = {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  employee_code: string;
  designation: string | null;
  department: string | null;
  location: string | null;
  phone: string | null;
  manager_id: string | null;
};

export const PERSON_COLUMNS = "id, full_name, email, avatar_url, employee_code, designation, department, location, phone, manager_id";

/** Ticket row plus the joins every ticket screen needs. */
export const TICKET_SELECT = `*,
  team:teams(id, key, name, color),
  category:categories(id, name),
  catalog_item:catalog_items(id, name, icon, fields),
  asset:assets(id, asset_tag, name, type, status),
  requester:people!requester_id(${PERSON_COLUMNS}),
  assignee:people!assignee_id(${PERSON_COLUMNS}),
  creator:people!created_by(id, full_name)`;

export type TicketRow = Tables<{ schema: "servicedesk" }, "tickets">;

export type TicketDetail = TicketRow & {
  team: { id: string; key: string; name: string; color: string } | null;
  category: { id: string; name: string } | null;
  catalog_item: { id: string; name: string; icon: string; fields: unknown } | null;
  asset: { id: string; asset_tag: string; name: string; type: string; status: string } | null;
  requester: Person | null;
  assignee: Person | null;
  creator: { id: string; full_name: string | null } | null;
};

export type AttachmentView = { id: string; name: string; size: number; mime: string | null; url: string | null; message_id: string | null; created_at: string };

export type TimelineItem =
  | {
      kind: "message";
      id: string;
      at: string;
      body: string;
      internal: boolean;
      author: { id: string; full_name: string | null; avatar_url: string | null } | null;
      attachments: AttachmentView[];
    }
  | { kind: "event"; id: string; at: string; event: string; from: string | null; to: string | null; actor: { id: string; full_name: string | null } | null };

export type ApprovalView = {
  id: string;
  kind: string;
  status: string;
  comment: string | null;
  decided_at: string | null;
  created_at: string;
  approver: { id: string; full_name: string | null } | null;
  decider: { id: string; full_name: string | null } | null;
  team: { name: string } | null;
};

export type TicketBundle = {
  ticket: TicketDetail;
  timeline: TimelineItem[];
  /** Attachments added with the ticket itself (not tied to a message). */
  ticketAttachments: AttachmentView[];
  approvals: ApprovalView[];
};

/**
 * Loads a ticket by its number with conversation, history, attachments and approvals.
 * RLS decides visibility (internal notes are hidden from requesters by the database).
 * Calls notFound() when the ticket doesn't exist or isn't visible.
 */
export async function loadTicket(number: number | string): Promise<TicketBundle> {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const supabase = await createClient();
  const { data: ticket } = await supabase.from("tickets").select(TICKET_SELECT).eq("number", n).maybeSingle();
  if (!ticket) notFound();
  const t = ticket as unknown as TicketDetail;

  const [{ data: messages }, { data: events }, { data: files }, { data: approvals }] = await Promise.all([
    supabase.from("ticket_messages").select("id, body, internal, created_at, author:people!author_id(id, full_name, avatar_url)").eq("ticket_id", t.id).order("created_at"),
    supabase.from("ticket_events").select("id, kind, from_value, to_value, created_at, actor:people!actor_id(id, full_name)").eq("ticket_id", t.id).order("created_at"),
    supabase.from("attachments").select("id, path, name, size, mime, message_id, created_at").eq("ticket_id", t.id).order("created_at"),
    supabase
      .from("approvals")
      .select("id, kind, status, comment, decided_at, created_at, approver:people!approver_id(id, full_name), decider:people!decided_by(id, full_name), team:teams(name)")
      .eq("ticket_id", t.id)
      .order("created_at"),
  ]);

  const urls = await signedUrls((files ?? []).map((f) => f.path));
  const views: AttachmentView[] = (files ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, url: urls[f.path] ?? null, message_id: f.message_id, created_at: f.created_at }));
  const byMessage = new Map<string, AttachmentView[]>();
  for (const v of views) if (v.message_id) byMessage.set(v.message_id, [...(byMessage.get(v.message_id) ?? []), v]);

  const timeline: TimelineItem[] = [
    ...(messages ?? []).map((m) => ({
      kind: "message" as const,
      id: m.id,
      at: m.created_at,
      body: m.body,
      internal: m.internal,
      author: m.author as unknown as { id: string; full_name: string | null; avatar_url: string | null } | null,
      attachments: byMessage.get(m.id) ?? [],
    })),
    ...(events ?? [])
      .filter((e) => e.kind !== "created")
      .map((e) => ({
        kind: "event" as const,
        id: e.id,
        at: e.created_at,
        event: e.kind,
        from: e.from_value,
        to: e.to_value,
        actor: e.actor as unknown as { id: string; full_name: string | null } | null,
      })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return {
    ticket: t,
    timeline,
    ticketAttachments: views.filter((v) => !v.message_id),
    approvals: (approvals ?? []) as unknown as ApprovalView[],
  };
}
