import "server-only";
import type { DeskClient } from "@/lib/supabase/server";
import { OPEN_STATUSES } from "@/lib/constants";
import { addDays, isValidDay, presetRange, rangeBounds, RANGE_PRESETS, type RangePreset, type ReportTicket } from "@/lib/reports/aggregate";

/** Most rows we pull for one report (each query). */
export const ROW_CAP = 5000;
/** Longest custom range we allow. */
export const MAX_RANGE_DAYS = 366;

const REPORT_COLUMNS =
  "id, status, priority, category_id, assignee_id, created_at, approved_at, first_response_due, first_responded_at, response_breached, resolution_due, resolved_at, resolution_breached, csat_rating";

export type ReportRange = { from: string; to: string; preset: RangePreset | null };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Read ?range= or ?from=&to= (India days). Falls back to the last 30 days. */
export function parseRange(params: Params, today: string): ReportRange {
  const preset = one(params.range);
  if (preset && RANGE_PRESETS.some((p) => p.key === preset)) return { ...presetRange(preset as RangePreset, today), preset: preset as RangePreset };

  let from = one(params.from);
  let to = one(params.to);
  if (isValidDay(from) || isValidDay(to)) {
    to = isValidDay(to) && to <= today ? to : today;
    from = isValidDay(from) ? from : addDays(to, -29);
    if (from > to) [from, to] = [to, from];
    if (from < addDays(to, -(MAX_RANGE_DAYS - 1))) from = addDays(to, -(MAX_RANGE_DAYS - 1));
    const match = RANGE_PRESETS.find((p) => {
      const r = presetRange(p.key, today);
      return r.from === from && r.to === to;
    });
    return { from, to, preset: match?.key ?? null };
  }
  return { ...presetRange("30d", today), preset: "30d" };
}

/** PostgREST returns at most 1000 rows per request, so page through up to ROW_CAP. */
async function pageAll(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const rows: ReportTicket[] = [];
  for (let from = 0; from < ROW_CAP; from += 1000) {
    const to = Math.min(ROW_CAP, from + 1000) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { rows, capped: false, error: error.message };
    rows.push(...((data ?? []) as ReportTicket[]));
    if (!data || data.length < to - from + 1) return { rows, capped: false, error: null };
  }
  return { rows, capped: rows.length >= ROW_CAP, error: null };
}

/** Tickets created or resolved in the range, plus everything open right now, for the given teams. */
export async function loadReportTickets(supabase: DeskClient, teamIds: string[], range: ReportRange) {
  if (teamIds.length === 0) return { tickets: [], open: [], capped: false, error: null };
  const { start, end } = rangeBounds(range.from, range.to);
  const inRange = `and(created_at.gte.${start},created_at.lt.${end}),and(resolved_at.gte.${start},resolved_at.lt.${end})`;

  const [tickets, open] = await Promise.all([
    pageAll((from, to) =>
      supabase.from("tickets").select(REPORT_COLUMNS).in("team_id", teamIds).or(inRange).order("created_at", { ascending: false }).order("id").range(from, to),
    ),
    pageAll((from, to) =>
      supabase.from("tickets").select(REPORT_COLUMNS).in("team_id", teamIds).in("status", OPEN_STATUSES).order("created_at", { ascending: false }).order("id").range(from, to),
    ),
  ]);
  return {
    tickets: tickets.rows,
    open: open.rows,
    capped: tickets.capped || open.capped,
    error: tickets.error ?? open.error,
  };
}

/** Category names and the team's agents (for labels and the workload table). */
export async function loadReportLookups(supabase: DeskClient, teamIds: string[]) {
  if (teamIds.length === 0) return { categories: new Map<string, string>(), agents: [] as { id: string; name: string; avatarUrl: string | null }[] };
  const [{ data: cats }, { data: members }] = await Promise.all([
    supabase.from("categories").select("id, name, team_id").in("team_id", teamIds),
    supabase.from("team_members").select("employee_id, person:people!employee_id(id, full_name, avatar_url, status)").in("team_id", teamIds),
  ]);
  const categories = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const seen = new Set<string>();
  const agents: { id: string; name: string; avatarUrl: string | null }[] = [];
  for (const m of members ?? []) {
    const p = m.person as unknown as { id: string; full_name: string | null; avatar_url: string | null; status: string } | null;
    if (!p || seen.has(p.id) || p.status === "exited") continue;
    seen.add(p.id);
    agents.push({ id: p.id, name: p.full_name ?? "Unknown", avatarUrl: p.avatar_url });
  }
  return { categories, agents };
}

/** Names for assignees that aren't (or are no longer) team members. */
export async function loadPeopleNames(supabase: DeskClient, ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; avatarUrl: string | null }>();
  const { data } = await supabase.from("people").select("id, full_name, avatar_url").in("id", ids.slice(0, 200));
  return new Map((data ?? []).map((p) => [p.id, { name: p.full_name ?? "Unknown", avatarUrl: p.avatar_url }]));
}
