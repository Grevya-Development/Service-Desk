/**
 * Pure report aggregation helpers (no I/O). Fed with RLS-filtered ticket rows
 * by /desk/reports and unit tested in tests/reports.test.ts.
 *
 * Calendar days are India days (Asia/Kolkata, UTC+05:30, no daylight saving),
 * matching how the rest of the desk shows dates (and the ticket CSV export).
 */

export type ReportTicket = {
  id: string;
  status: string;
  priority: string;
  category_id: string | null;
  assignee_id: string | null;
  created_at: string;
  approved_at: string | null;
  first_response_due: string | null;
  first_responded_at: string | null;
  response_breached: boolean;
  resolution_due: string | null;
  resolved_at: string | null;
  resolution_breached: boolean;
  csat_rating: string | null;
};

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

// ---------------------------------------------------------------------------
// Basic maths
// ---------------------------------------------------------------------------

/** Median of the finite numbers in `values`; null when there are none. */
export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** part / whole as a percentage (0–100); null when whole is 0. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

export type Rate = { met: number; total: number; pct: number | null };
const rate = (met: number, total: number): Rate => ({ met, total, pct: percent(met, total) });

// ---------------------------------------------------------------------------
// Dates and ranges
// ---------------------------------------------------------------------------

/** India calendar day ("yyyy-MM-dd") of an instant. */
export function istDay(iso: string | number): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Add whole days to a "yyyy-MM-dd" string. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Every "yyyy-MM-dd" from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  for (let i = 0; d <= to && i < 1000; i++) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** Inclusive India-day range → half-open UTC instant range [start, end). */
export function rangeBounds(from: string, to: string): { start: string; end: string } {
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - IST_OFFSET_MS).toISOString();
  const end = new Date(Date.parse(`${addDays(to, 1)}T00:00:00Z`) - IST_OFFSET_MS).toISOString();
  return { start, end };
}

export const isValidDay = (s: string | null | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

export type RangePreset = "7d" | "30d" | "90d" | "month";
export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "month", label: "This month" },
];

/** Date range for a preset, ending today (India). */
export function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  switch (preset) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      return { from: addDays(today, -29), to: today };
  }
}

/** Is the instant inside the half-open range? */
export function inRange(iso: string | null, start: string, end: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= Date.parse(start) && t < Date.parse(end);
}

// ---------------------------------------------------------------------------
// SLA, timings, satisfaction
// ---------------------------------------------------------------------------

/** When the SLA clock started: approval time for requests that needed one, else creation. */
const clockStart = (t: ReportTicket) => t.approved_at ?? t.created_at;

type SlaFields = Pick<ReportTicket, "first_response_due" | "first_responded_at" | "response_breached" | "resolution_due" | "resolved_at" | "resolution_breached">;

/**
 * Was the first-response target met? null when there is no target or no
 * outcome yet (no reply and not breached).
 */
export function responseSlaMet(t: SlaFields): boolean | null {
  if (!t.first_response_due) return null;
  if (!t.first_responded_at && !t.response_breached) return null;
  return Boolean(t.first_responded_at && !t.response_breached && ms(t.first_responded_at) <= ms(t.first_response_due));
}

/** Was the resolution target met? null unless the ticket is resolved and had a target. */
export function resolutionSlaMet(t: SlaFields): boolean | null {
  if (!t.resolved_at || !t.resolution_due) return null;
  return !t.resolution_breached && ms(t.resolved_at) <= ms(t.resolution_due);
}

function slaRate(tickets: ReportTicket[], outcome: (t: ReportTicket) => boolean | null): Rate {
  let met = 0;
  let total = 0;
  for (const t of tickets) {
    const o = outcome(t);
    if (o === null) continue;
    total++;
    if (o) met++;
  }
  return rate(met, total);
}

/** First-response SLA among tickets that have a target and an outcome (a first reply, or a breach). */
export function responseSlaRate(tickets: ReportTicket[]): Rate {
  return slaRate(tickets, responseSlaMet);
}

/** Resolution SLA among resolved tickets that had a resolution target. */
export function resolutionSlaRate(tickets: ReportTicket[]): Rate {
  return slaRate(tickets, resolutionSlaMet);
}

/** Wall-clock minutes from clock start to first reply (null if no reply yet). */
export function firstResponseMinutes(t: ReportTicket): number | null {
  if (!t.first_responded_at) return null;
  const m = (ms(t.first_responded_at) - ms(clockStart(t))) / 60_000;
  return Number.isFinite(m) ? Math.max(0, m) : null;
}

/** Wall-clock minutes from clock start to resolution (null if not resolved). */
export function resolutionMinutes(t: ReportTicket): number | null {
  if (!t.resolved_at) return null;
  const m = (ms(t.resolved_at) - ms(clockStart(t))) / 60_000;
  return Number.isFinite(m) ? Math.max(0, m) : null;
}

const nonNull = (v: number | null): v is number => v !== null;

export function medianFirstResponse(tickets: ReportTicket[]): number | null {
  return median(tickets.map(firstResponseMinutes).filter(nonNull));
}

export function medianResolution(tickets: ReportTicket[]): number | null {
  return median(tickets.map(resolutionMinutes).filter(nonNull));
}

export type Csat = { good: number; bad: number; rated: number; pct: number | null };

/** Share of rated tickets marked "good". */
export function csatSummary(tickets: ReportTicket[]): Csat {
  let good = 0;
  let bad = 0;
  for (const t of tickets) {
    if (t.csat_rating === "good") good++;
    else if (t.csat_rating === "bad") bad++;
  }
  return { good, bad, rated: good + bad, pct: percent(good, good + bad) };
}

// ---------------------------------------------------------------------------
// Series and breakdowns
// ---------------------------------------------------------------------------

export type DayPoint = { day: string; created: number; resolved: number };

/**
 * Tickets created and resolved per India day from `from` to `to` (inclusive),
 * with zero-filled days so the line has no gaps.
 */
export function dailySeries(tickets: ReportTicket[], from: string, to: string): DayPoint[] {
  const points = daysBetween(from, to).map((day) => ({ day, created: 0, resolved: 0 }));
  const index = new Map(points.map((p, i) => [p.day, i]));
  const seen = new Set<string>();
  for (const t of tickets) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const c = index.get(istDay(t.created_at));
    if (c !== undefined) points[c].created++;
    if (t.resolved_at) {
      const r = index.get(istDay(t.resolved_at));
      if (r !== undefined) points[r].resolved++;
    }
  }
  return points;
}

export type Slice = { key: string; label: string; count: number };

/** Count tickets by a key, sorted by count (desc) then label; null keys go to `fallbackLabel`. */
export function countBy(
  tickets: ReportTicket[],
  keyOf: (t: ReportTicket) => string | null,
  labelOf: (key: string) => string,
  fallbackLabel = "Not set",
): Slice[] {
  const counts = new Map<string, number>();
  for (const t of tickets) {
    const k = keyOf(t) ?? "";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key ? labelOf(key) : fallbackLabel, count }))
    .sort((a, b) => b.count - a.count || Number(!a.key) - Number(!b.key) || a.label.localeCompare(b.label));
}

/** Count tickets for each key in a fixed order (zero-filled), e.g. priorities. */
export function countInOrder(tickets: ReportTicket[], keyOf: (t: ReportTicket) => string, order: readonly { key: string; label: string }[]): Slice[] {
  const counts = new Map<string, number>();
  for (const t of tickets) counts.set(keyOf(t), (counts.get(keyOf(t)) ?? 0) + 1);
  return order.map((o) => ({ key: o.key, label: o.label, count: counts.get(o.key) ?? 0 }));
}

export const AGE_BUCKETS = [
  { key: "lt1d", label: "Under 1 day", maxHours: 24 },
  { key: "1to3d", label: "1–3 days", maxHours: 72 },
  { key: "3to7d", label: "3–7 days", maxHours: 168 },
  { key: "gt7d", label: "Over 7 days", maxHours: Infinity },
] as const;

/** Open tickets grouped by how long ago they were raised. */
export function backlogAgeBuckets(open: ReportTicket[], now: number): Slice[] {
  const counts = AGE_BUCKETS.map(() => 0);
  for (const t of open) {
    const hours = Math.max(0, (now - ms(t.created_at)) / HOUR_MS);
    if (!Number.isFinite(hours)) continue;
    const i = AGE_BUCKETS.findIndex((b) => hours < b.maxHours);
    counts[i === -1 ? AGE_BUCKETS.length - 1 : i]++;
  }
  return AGE_BUCKETS.map((b, i) => ({ key: b.key, label: b.label, count: counts[i] }));
}

// ---------------------------------------------------------------------------
// Agent workload
// ---------------------------------------------------------------------------

export type AgentRow = {
  agentId: string;
  openAssigned: number;
  resolvedInRange: number;
  csat: Csat;
  sla: Rate;
};

/**
 * Per-agent workload: open tickets assigned now, tickets they resolved in the
 * range, satisfaction on those, and how many were resolved within the SLA.
 * `agentIds` are always listed (even with zero work); other assignees found in
 * the data are added too.
 */
export function agentWorkload(resolvedInRange: ReportTicket[], open: ReportTicket[], agentIds: string[] = []): AgentRow[] {
  const ids = new Set(agentIds);
  for (const t of [...open, ...resolvedInRange]) if (t.assignee_id) ids.add(t.assignee_id);

  const openBy = new Map<string, number>();
  for (const t of open) if (t.assignee_id) openBy.set(t.assignee_id, (openBy.get(t.assignee_id) ?? 0) + 1);
  const resolvedBy = new Map<string, ReportTicket[]>();
  for (const t of resolvedInRange) {
    if (!t.assignee_id) continue;
    const list = resolvedBy.get(t.assignee_id) ?? [];
    list.push(t);
    resolvedBy.set(t.assignee_id, list);
  }

  return [...ids]
    .map((agentId) => {
      const done = resolvedBy.get(agentId) ?? [];
      return {
        agentId,
        openAssigned: openBy.get(agentId) ?? 0,
        resolvedInRange: done.length,
        csat: csatSummary(done),
        sla: resolutionSlaRate(done),
      };
    })
    .sort((a, b) => b.openAssigned + b.resolvedInRange - (a.openAssigned + a.resolvedInRange) || a.agentId.localeCompare(b.agentId));
}

// ---------------------------------------------------------------------------
// Everything at once
// ---------------------------------------------------------------------------

export type ReportInput = {
  /** Tickets created OR resolved in the range (may overlap with `open`). */
  tickets: ReportTicket[];
  /** Tickets open right now. */
  open: ReportTicket[];
  from: string;
  to: string;
  now: number;
};

export type ReportKpis = {
  created: number;
  resolved: number;
  backlog: number;
  responseSla: Rate;
  resolutionSla: Rate;
  medianFirstResponseMins: number | null;
  medianResolutionMins: number | null;
  csat: Csat;
};

/** Split the range rows into "created in range" and "resolved in range" and compute the KPIs. */
export function buildKpis({ tickets, open, from, to }: ReportInput): { kpis: ReportKpis; created: ReportTicket[]; resolved: ReportTicket[] } {
  const { start, end } = rangeBounds(from, to);
  const created = tickets.filter((t) => inRange(t.created_at, start, end));
  const resolved = tickets.filter((t) => inRange(t.resolved_at, start, end));
  return {
    created,
    resolved,
    kpis: {
      created: created.length,
      resolved: resolved.length,
      backlog: open.length,
      responseSla: responseSlaRate(created),
      resolutionSla: resolutionSlaRate(resolved),
      medianFirstResponseMins: medianFirstResponse(created),
      medianResolutionMins: medianResolution(resolved),
      csat: csatSummary(resolved),
    },
  };
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export type ReportIncident = { id: string; started_at: string; resolved_at: string | null; status: string };
export type IncidentSummary = { declared: number; resolved: number; stillOpen: number; medianResolveMins: number | null };

/**
 * Incidents declared (started) in the India-day range, how many of those are
 * resolved / still open, and the median wall-clock minutes from start to resolution.
 */
export function incidentSummary(incidents: ReportIncident[], from: string, to: string): IncidentSummary {
  const { start, end } = rangeBounds(from, to);
  const declared = incidents.filter((i) => inRange(i.started_at, start, end));
  const durations: number[] = [];
  for (const i of declared) {
    if (!i.resolved_at) continue;
    const m = (ms(i.resolved_at) - ms(i.started_at)) / 60_000;
    if (Number.isFinite(m)) durations.push(Math.max(0, m));
  }
  return {
    declared: declared.length,
    resolved: durations.length,
    stillOpen: declared.filter((i) => !i.resolved_at && i.status !== "resolved").length,
    medianResolveMins: median(durations),
  };
}
