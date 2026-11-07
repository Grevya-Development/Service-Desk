import { PRIORITY_META, isPriority, type Priority } from "@/lib/constants";
import { primarySla, type SlaTicket } from "@/lib/sla";
import { formatDate, orgToday } from "@/lib/utils";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export const PAGE_SIZE = 30;
/** Upper bound of rows sorted in memory per view (queues are small; this is a safety cap). */
export const MAX_ROWS = 2000;

export const VIEWS = [
  { key: "unassigned", label: "Unassigned" },
  { key: "mine", label: "Mine" },
  { key: "open", label: "All open" },
  { key: "breaching", label: "Breaching soon" },
  { key: "pending", label: "Pending" },
  { key: "approval", label: "Awaiting approval" },
  { key: "resolved", label: "Resolved" },
] as const;
export type ViewKey = (typeof VIEWS)[number]["key"];
export const DEFAULT_VIEW: ViewKey = "unassigned";

export const SORTS = { sla: "SLA urgency", newest: "Newest first", oldest: "Oldest first", priority: "Priority" } as const;
export type SortKey = keyof typeof SORTS;
export const DEFAULT_SORT: SortKey = "sla";

export type QueueParams = {
  view: ViewKey;
  team: string | null;
  priority: Priority | null;
  category: string | null;
  /** employee id or "unassigned" */
  assignee: string | null;
  q: string | null;
  sort: SortKey;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

/** Parse and validate GET params. Unknown or out-of-scope values are dropped. */
export function parseQueueParams(sp: RawParams, ctx: { teamIds: string[]; categoryIds: string[]; agentIds: string[] }): QueueParams {
  const view = first(sp.view);
  const team = first(sp.team);
  const priority = first(sp.priority);
  const category = first(sp.category);
  const assignee = first(sp.assignee);
  const sort = first(sp.sort);
  const page = Number(first(sp.page) ?? 1);
  const q = first(sp.q)?.slice(0, 100) ?? null;
  return {
    view: VIEWS.some((v) => v.key === view) ? (view as ViewKey) : DEFAULT_VIEW,
    team: team && ctx.teamIds.includes(team) ? team : null,
    priority: isPriority(priority) ? priority : null,
    category: category && ctx.categoryIds.includes(category) ? category : null,
    assignee: assignee === "unassigned" || (assignee && ctx.agentIds.includes(assignee)) ? assignee : null,
    q,
    sort: sort && sort in SORTS ? (sort as SortKey) : DEFAULT_SORT,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/**
 * Canonical /desk URL (fixed key order, defaults omitted) so LinkTabs can match it exactly.
 * `view` is always present: LinkTabs falls back to a tab whose href equals the bare
 * pathname, so a "/desk" tab would wrongly light up on page 2 of another view.
 */
export function queueHref(p: QueueParams, patch: Partial<QueueParams> = {}) {
  const v = { ...p, ...patch };
  const qs = new URLSearchParams();
  qs.set("view", v.view);
  if (v.team) qs.set("team", v.team);
  if (v.priority) qs.set("priority", v.priority);
  if (v.category) qs.set("category", v.category);
  if (v.assignee) qs.set("assignee", v.assignee);
  if (v.q) qs.set("q", v.q);
  if (v.sort !== DEFAULT_SORT) qs.set("sort", v.sort);
  if (v.page > 1) qs.set("page", String(v.page));
  return `/desk?${qs.toString()}`;
}

/** The query string as the browser sent it, normalised the same way as queueHref. */
export function rawHref(sp: RawParams) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v !== undefined) qs.append(k, v);
  }
  const s = qs.toString();
  return s ? `/desk?${s}` : "/desk";
}

/** Text search → safe value for PostgREST filters (no wildcards / filter syntax). */
export function cleanSearch(q: string | null) {
  if (!q) return { text: null, number: null };
  const m = /^(?:sd-?)?(\d{1,9})$/i.exec(q.trim());
  const text = q.replace(/[%_*\\"(),.:]/g, " ").replace(/\s+/g, " ").trim() || null;
  return { text, number: m ? Number(m[1]) : null };
}

/** Times used by the queue filters, computed once per request. */
export function queueClock() {
  const now = Date.now();
  return {
    now,
    soon: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    monthAgo: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
    todayStart: new Date(`${orgToday()}T00:00:00+05:30`).toISOString(),
  };
}

export type LightTicket = SlaTicket & {
  id: string;
  number: number;
  priority: string;
  updated_at: string;
  pending_since: string | null;
};

const priorityRank = (p: string) => (isPriority(p) ? PRIORITY_META[p].rank : 9);

/** Deadline that matters right now: first response until answered, then resolution. */
function activeDue(t: LightTicket) {
  if (t.status === "resolved" || t.status === "closed" || t.status === "pending" || t.approval_status === "pending") return null;
  const due = !t.first_responded_at && t.first_response_due ? t.first_response_due : t.resolution_due;
  return due ? Date.parse(due) : null;
}

/** Sort in memory: SLA urgency (breached first, then nearest due), newest, oldest or priority. */
export function sortTickets<T extends LightTicket>(rows: T[], sort: SortKey, now: number): T[] {
  const out = [...rows];
  const created = (t: T) => Date.parse(t.created_at);
  if (sort === "newest") return out.sort((a, b) => created(b) - created(a));
  if (sort === "oldest") return out.sort((a, b) => created(a) - created(b));
  if (sort === "priority") return out.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || created(a) - created(b));
  const key = (t: T) => {
    const kind = primarySla(t, now).kind;
    const due = activeDue(t);
    // 0 = breached, 1 = has a running deadline, 2 = paused / waiting / no SLA, 3 = done
    const bucket = t.status === "resolved" || t.status === "closed" ? 3 : kind === "breached" ? 0 : due !== null ? 1 : 2;
    return { bucket, due: due ?? Number.MAX_SAFE_INTEGER };
  };
  return out
    .map((t) => ({ t, k: key(t) }))
    .sort((a, b) => {
      if (a.k.bucket !== b.k.bucket) return a.k.bucket - b.k.bucket;
      if (a.k.bucket === 3) return Date.parse(b.t.updated_at) - Date.parse(a.t.updated_at);
      return a.k.due - b.k.due || priorityRank(a.t.priority) - priorityRank(b.t.priority) || created(a.t) - created(b.t);
    })
    .map((x) => x.t);
}

/** "just now", "12m ago", "3h ago", "2d ago", then a date. */
export function relativeTime(iso: string, now: number) {
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}
