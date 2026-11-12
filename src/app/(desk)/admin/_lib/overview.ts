import "server-only";
import type { DeskClient } from "@/lib/supabase/server";
import { OPEN_STATUSES } from "@/lib/constants";
import { addDays, rangeBounds, type ReportTicket } from "@/lib/reports/aggregate";
import { pageAll, type ReportRange } from "../../desk/reports/_lib/load";

/** Report columns plus what the overview splits by (team, approval). */
export type OverviewTicket = ReportTicket & { team_id: string; approval_status: string };

const COLUMNS =
  "id, team_id, status, approval_status, priority, category_id, assignee_id, created_at, approved_at, first_response_due, first_responded_at, response_breached, resolution_due, resolved_at, resolution_breached, csat_rating";

/** Tickets created or resolved in the range, and everything open now, across the given teams. */
export async function loadOverviewTickets(supabase: DeskClient, teamIds: string[], range: ReportRange) {
  if (teamIds.length === 0) return { tickets: [] as OverviewTicket[], open: [] as OverviewTicket[], capped: false, error: null as string | null };
  const { start, end } = rangeBounds(range.from, range.to);
  const inRange = `and(created_at.gte.${start},created_at.lt.${end}),and(resolved_at.gte.${start},resolved_at.lt.${end})`;
  const [tickets, open] = await Promise.all([
    pageAll<OverviewTicket>((from, to) =>
      supabase.from("tickets").select(COLUMNS).in("team_id", teamIds).or(inRange).order("created_at", { ascending: false }).order("id").range(from, to),
    ),
    pageAll<OverviewTicket>((from, to) =>
      supabase.from("tickets").select(COLUMNS).in("team_id", teamIds).in("status", OPEN_STATUSES).order("created_at", { ascending: false }).order("id").range(from, to),
    ),
  ]);
  return { tickets: tickets.rows, open: open.rows, capped: tickets.capped || open.capped, error: tickets.error ?? open.error };
}

/**
 * Is this open ticket past an SLA target right now? Pending tickets (waiting on the requester) and
 * requests still awaiting approval have their clocks stopped, so they never count.
 */
export function isOverdue(t: OverviewTicket, now: number): boolean {
  if (!(t.status === "new" || t.status === "open") || t.approval_status === "pending") return false;
  if (t.resolution_breached) return true;
  if (t.resolution_due && Date.parse(t.resolution_due) < now) return true;
  if (!t.first_responded_at) {
    if (t.response_breached) return true;
    if (t.first_response_due && Date.parse(t.first_response_due) < now) return true;
  }
  return false;
}

/** Created in the last 7 India days vs the 7 before, and resolved in the last 7. */
export async function loadWeekCounts(supabase: DeskClient, teamIds: string[], today: string) {
  if (teamIds.length === 0) return { createdThisWeek: 0, createdLastWeek: 0, resolvedThisWeek: 0 };
  const thisWeek = rangeBounds(addDays(today, -6), today);
  const lastWeek = rangeBounds(addDays(today, -13), addDays(today, -7));
  const head = { count: "exact" as const, head: true };
  const [a, b, c] = await Promise.all([
    supabase.from("tickets").select("id", head).in("team_id", teamIds).gte("created_at", thisWeek.start).lt("created_at", thisWeek.end),
    supabase.from("tickets").select("id", head).in("team_id", teamIds).gte("created_at", lastWeek.start).lt("created_at", lastWeek.end),
    supabase.from("tickets").select("id", head).in("team_id", teamIds).gte("resolved_at", thisWeek.start).lt("resolved_at", thisWeek.end),
  ]);
  return { createdThisWeek: a.count ?? 0, createdLastWeek: b.count ?? 0, resolvedThisWeek: c.count ?? 0 };
}

/** "+3 vs last week" style change text. */
export function weekChange(now: number, before: number): string {
  if (now === before) return "Same as the week before";
  const diff = now - before;
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs the week before`;
}
