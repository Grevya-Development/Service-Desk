import type { Tone } from "@/components/ui/badge";

/** "45m", "3h 20m", "2d 4h" (wall-clock). */
export function formatDuration(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** SLA target in business minutes as words: 30 → "30m", 480 → "8h" (business hours). */
export function formatTarget(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h}h` : `${Math.floor(h)}h ${minutes % 60}m`;
}

export type SlaTicket = {
  status: string;
  approval_status?: string | null;
  first_response_due: string | null;
  resolution_due: string | null;
  first_responded_at: string | null;
  resolved_at: string | null;
  response_breached: boolean;
  resolution_breached: boolean;
  created_at: string;
  approved_at?: string | null;
};

export type SlaState = {
  kind: "none" | "paused" | "waiting_approval" | "met" | "missed" | "breached" | "at_risk" | "on_track";
  tone: Tone;
  label: string;
  due: string | null;
};

function classify(due: string | null, doneAt: string | null, breachedFlag: boolean, start: string, now: number): SlaState {
  if (!due) return { kind: "none", tone: "gray", label: "No SLA", due: null };
  const dueMs = Date.parse(due);
  if (doneAt) {
    const met = !breachedFlag && Date.parse(doneAt) <= dueMs;
    return met ? { kind: "met", tone: "green", label: "Met", due } : { kind: "missed", tone: "red", label: "Missed", due };
  }
  if (breachedFlag || now > dueMs) {
    return { kind: "breached", tone: "red", label: `Overdue ${formatDuration((now - dueMs) / 60000)}`, due };
  }
  const total = dueMs - Date.parse(start);
  const left = dueMs - now;
  if (left <= Math.max(15 * 60000, total * 0.25)) {
    return { kind: "at_risk", tone: "orange", label: `Due in ${formatDuration(left / 60000)}`, due };
  }
  return { kind: "on_track", tone: "green", label: `Due in ${formatDuration(left / 60000)}`, due };
}

/** First-response and resolution SLA states for a ticket. */
export function slaStates(t: SlaTicket, now = Date.now()): { response: SlaState; resolution: SlaState } {
  if (t.approval_status === "pending") {
    const s: SlaState = { kind: "waiting_approval", tone: "yellow", label: "Starts after approval", due: null };
    return { response: s, resolution: s };
  }
  const start = t.approved_at ?? t.created_at;
  const response = classify(t.first_response_due, t.first_responded_at, t.response_breached, start, now);
  let resolution = classify(t.resolution_due, t.resolved_at, t.resolution_breached, start, now);
  if (t.status === "pending" && !t.resolved_at && t.resolution_due) {
    resolution = { kind: "paused", tone: "yellow", label: "Paused (waiting on requester)", due: t.resolution_due };
  }
  if (t.status === "closed" && !t.resolved_at && t.resolution_due) {
    resolution = { kind: "none", tone: "gray", label: "Closed", due: t.resolution_due };
  }
  return { response, resolution };
}

/** The single most relevant SLA state for list views. */
export function primarySla(t: SlaTicket, now = Date.now()): SlaState {
  const { response, resolution } = slaStates(t, now);
  if (t.status === "resolved" || t.status === "closed") return resolution;
  if (!t.first_responded_at && response.kind !== "none" && response.kind !== "waiting_approval") {
    return { ...response, label: response.kind === "breached" ? `Response ${response.label.toLowerCase()}` : `Respond: ${response.label.replace("Due in ", "")}` };
  }
  return resolution;
}
