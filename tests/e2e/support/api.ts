/**
 * Test-data helpers that talk to the local Supabase API *as a real demo user*
 * (password sign-in, anon key). Row-level security and the database triggers
 * apply exactly as they do for the app, so data created here is indistinguishable
 * from data created through the UI — it is just much faster to set up.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PASSWORD, USERS, type Role } from "./users";

type Client = SupabaseClient<any, "servicedesk", any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const clients = new Map<Role, Promise<Client>>();
const ids = new Map<string, string>();
const teamIds = new Map<string, string>();

/** A Supabase client signed in as `role` (cached per test worker). */
export function api(role: Role): Promise<Client> {
  let c = clients.get(role);
  if (!c) {
    c = (async () => {
      const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        db: { schema: "servicedesk" },
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as Client;
      const { error } = await client.auth.signInWithPassword({ email: USERS[role].email, password: PASSWORD });
      if (error) throw new Error(`API sign-in failed for ${role}: ${error.message}`);
      return client;
    })();
    clients.set(role, c);
  }
  return c;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: no data`);
  return res.data;
}

/** Employee id (people.id) for a demo user. */
export async function employeeId(role: Role): Promise<string> {
  const email = USERS[role].email;
  const cached = ids.get(email);
  if (cached) return cached;
  const db = await api(role);
  const row = must(await db.from("people").select("id").eq("email", email).single(), `employee id for ${email}`) as { id: string };
  ids.set(email, row.id);
  return row.id;
}

export async function teamId(key: "it" | "hr"): Promise<string> {
  const cached = teamIds.get(key);
  if (cached) return cached;
  const db = await api("priya");
  const row = must(await db.from("teams").select("id").eq("key", key).single(), `team ${key}`) as { id: string };
  teamIds.set(key, row.id);
  return row.id;
}

export async function categoryId(team: "it" | "hr", name: string): Promise<string> {
  const db = await api("priya");
  const row = must(await db.from("categories").select("id").eq("team_id", await teamId(team)).eq("name", name).single(), `category ${name}`) as {
    id: string;
  };
  return row.id;
}

export type TicketRef = { id: string; number: number; subject: string };

/** Raise an issue as `requester` (same insert as "Report an issue"). */
export async function createTicket(
  requester: Role,
  opts: { subject: string; team?: "it" | "hr"; category?: string; description?: string; priority?: "low" | "medium" | "high" | "urgent" },
): Promise<TicketRef> {
  const team = opts.team ?? "it";
  const db = await api(requester);
  const row = must(
    await db
      .from("tickets")
      .insert({
        requester_id: await employeeId(requester),
        team_id: await teamId(team),
        category_id: await categoryId(team, opts.category ?? "Other"),
        subject: opts.subject,
        description: opts.description ?? `Created by the end-to-end suite: ${opts.subject}`,
        priority: opts.priority ?? "medium",
        type: "incident",
      })
      .select("id, number")
      .single(),
    `create ticket "${opts.subject}"`,
  ) as { id: string; number: number };
  return { ...row, subject: opts.subject };
}

export async function getTicket(role: Role, number: number) {
  const db = await api(role);
  return must(
    await db.from("tickets").select("id, number, status, assignee_id, team_id, incident_id, merged_into, csat_rating").eq("number", number).single(),
    `ticket ${number}`,
  ) as { id: string; number: number; status: string; assignee_id: string | null; team_id: string; incident_id: string | null; merged_into: string | null; csat_rating: string | null };
}

/** Agent: post a public reply and set the status (what "Resolve" / "Mark pending" do). */
export async function agentSetStatus(agent: Role, ticket: TicketRef, status: "resolved" | "pending" | "open", note?: string) {
  const db = await api(agent);
  if (note) must(await db.from("ticket_messages").insert({ ticket_id: ticket.id, body: note, internal: false, author_id: await employeeId(agent) }).select("id").single(), "post message");
  const { error } = await db.from("tickets").update({ status }).eq("id", ticket.id);
  if (error) throw new Error(`set status ${status} on ${ticket.number}: ${error.message}`);
}

export async function declareIncident(agent: Role, title: string, opts: { team?: "it" | "hr"; severity?: "major" | "minor"; summary?: string } = {}) {
  const db = await api(agent);
  return must(
    await db
      .from("incidents")
      .insert({
        team_id: await teamId(opts.team ?? "it"),
        title,
        summary: opts.summary ?? `Some people are affected by ${title}. We're on it.`,
        severity: opts.severity ?? "major",
        created_by: await employeeId(agent),
      })
      .select("id, title")
      .single(),
    `declare incident ${title}`,
  ) as { id: string; title: string };
}

export async function linkTicketToIncident(agent: Role, ticket: TicketRef, incidentId: string) {
  const db = await api(agent);
  const { error } = await db.from("tickets").update({ incident_id: incidentId }).eq("id", ticket.id);
  if (error) throw new Error(`link ${ticket.number} to incident: ${error.message}`);
}

/** Resolve every active incident (any team) as the desk admin. Returns how many were resolved. */
export async function resolveAllIncidents(): Promise<number> {
  const db = await api("admin");
  const active = must(await db.from("incidents").select("id").neq("status", "resolved"), "list active incidents") as { id: string }[];
  for (const i of active) {
    const { error } = await db.rpc("resolve_incident", { p_id: i.id, p_message: "Resolved by the end-to-end suite.", p_resolve_tickets: false });
    if (error) throw new Error(`resolve incident ${i.id}: ${error.message}`);
  }
  return active.length;
}

/** Short unique token for subjects/titles so tests never collide with each other or old runs. */
export function uid(prefix = "E2E") {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
