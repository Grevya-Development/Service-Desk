import "server-only";
import type { Viewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { applyScope, applyView } from "./filters";
import { MAX_ROWS, parseQueueParams, queueClock, sortTickets, type LightTicket, type QueueParams } from "./queue";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type RawParams = Record<string, string | string[] | undefined>;

export type QueueAgent = { id: string; name: string; teamIds: string[] };
export type QueueTeam = { id: string; name: string; color: string };

/** Teams, categories and agents the viewer works with, plus the validated queue params. */
export async function loadQueueContext(supabase: Supabase, me: Viewer, sp: RawParams) {
  const teamIds = me.agentTeamIds;
  const [{ data: teams }, { data: categories }, { data: members }] = await Promise.all([
    supabase.from("teams").select("id, name, color").in("id", teamIds).order("sort_order"),
    supabase.from("categories").select("id, name, team_id").in("team_id", teamIds).order("sort_order").order("name"),
    supabase.from("team_members").select("team_id, person:people!employee_id(id, full_name, status)").in("team_id", teamIds),
  ]);

  const agents = new Map<string, QueueAgent>();
  for (const m of members ?? []) {
    const p = m.person as unknown as { id: string; full_name: string | null; status: string } | null;
    if (!p || p.status === "exited") continue;
    const cur = agents.get(p.id);
    if (cur) cur.teamIds.push(m.team_id);
    else agents.set(p.id, { id: p.id, name: p.full_name ?? "Unnamed", teamIds: [m.team_id] });
  }

  const team = typeof sp.team === "string" ? sp.team : null;
  const params = parseQueueParams(sp, {
    teamIds: (teams ?? []).map((t) => t.id),
    categoryIds: (categories ?? []).filter((c) => c.team_id === team).map((c) => c.id),
    agentIds: [...agents.keys()],
  });

  return { teamIds, teams: (teams ?? []) as QueueTeam[], categories: categories ?? [], agents, params };
}

export const ROW_SELECT = `id, number, subject, status, priority, approval_status, team_id, assignee_id, category_id, created_at, updated_at, approved_at,
  first_response_due, resolution_due, first_responded_at, resolved_at, response_breached, resolution_breached, pending_since, incident_id,
  requester:people!requester_id(full_name, email, department),
  assignee:people!assignee_id(id, full_name, avatar_url)`;

export type QueueRow = LightTicket & {
  subject: string;
  team_id: string;
  assignee_id: string | null;
  category_id: string | null;
  incident_id: string | null;
  requester: { full_name: string | null; email: string | null; department: string | null } | null;
  assignee: { id: string; full_name: string | null; avatar_url: string | null } | null;
};

/** Rows of a view + filters, sorted like the queue. `limit` caps rows; fetched in pages of `chunk`. */
export async function fetchQueueRows(
  supabase: Supabase,
  params: QueueParams,
  teamIds: string[],
  meId: string,
  { limit = MAX_ROWS, chunk = 1000 }: { limit?: number; chunk?: number } = {},
): Promise<{ rows: QueueRow[]; error: string | null; clock: ReturnType<typeof queueClock> }> {
  const clock = queueClock();
  const rows: QueueRow[] = [];
  for (let from = 0; from < limit; from += chunk) {
    const to = Math.min(from + chunk, limit) - 1;
    const { data, error } = await applyView(applyScope(supabase.from("tickets").select(ROW_SELECT), params, teamIds), params.view, meId, clock)
      .order("updated_at", { ascending: false })
      .order("id")
      .range(from, to);
    if (error) return { rows, error: error.message, clock };
    rows.push(...((data ?? []) as unknown as QueueRow[]));
    if (!data || data.length < to - from + 1) break;
  }
  return { rows: sortTickets(rows, params.sort, clock.now), error: null, clock };
}
