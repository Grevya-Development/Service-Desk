/** Incident vocabulary shared by /status and /desk/incidents. Plain words for non-technical readers. */

export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Statuses an agent can pick when posting an update (resolving has its own dialog). */
export const UPDATE_STATUSES = ["investigating", "identified", "monitoring"] as const;

export const INCIDENT_STATUS_META: Record<IncidentStatus, { label: string; hint: string }> = {
  investigating: { label: "Investigating", hint: "We're looking into what's wrong." },
  identified: { label: "Identified", hint: "We know the cause and are working on a fix." },
  monitoring: { label: "Monitoring", hint: "A fix is in place. We're checking it holds." },
  resolved: { label: "Resolved", hint: "It's fixed. Everything should work normally." },
};

export const SEVERITIES = ["major", "minor"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_META: Record<Severity, { label: string; hint: string; badge: string; dot: string; bar: string; panel: string }> = {
  major: {
    label: "Major",
    hint: "Many people can't work, or something important is down.",
    badge: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
    bar: "bg-red-500",
    panel: "border-red-200 bg-red-50",
  },
  minor: {
    label: "Minor",
    hint: "Some people are affected, or there's a workaround.",
    badge: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    panel: "border-amber-200 bg-amber-50",
  },
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isIncidentStatus(v: unknown): v is IncidentStatus {
  return typeof v === "string" && (INCIDENT_STATUSES as readonly string[]).includes(v);
}

export function isSeverity(v: unknown): v is Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

export function severityOf(v: string): Severity {
  return isSeverity(v) ? v : "major";
}

/** Minutes between two instants (end defaults to now). */
export function minutesBetween(start: string, end?: string | null) {
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((b - a) / 60000));
}

/** ISO timestamp `days` days ago. */
export function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/** "3 people" / "1 person" */
export function peopleCount(n: number) {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/** Only allow #rrggbb team colours into inline styles. */
export function safeColor(color: string | null | undefined) {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#64748b";
}

/** "less than a minute" / "2h 15m" */
export function durationText(minutes: number) {
  if (minutes < 1) return "less than a minute";
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
