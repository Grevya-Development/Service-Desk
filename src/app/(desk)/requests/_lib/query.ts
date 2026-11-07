/** Helpers shared by the requester screens (home, requests, search). */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "SD-1042", "sd1042", "sd 1042", "#1042", "1042" → 1042. */
export function parseTicketNumber(q: string | null | undefined): number | null {
  const m = /^\s*#?(?:sd[-\s]?)?(\d{1,12})\s*$/i.exec(q ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Strip characters that would break a PostgREST filter (`or=(…)`, `ilike` wildcards, quoting). */
export function sanitizeSearch(q: string | null | undefined, max = 100): string {
  return (q ?? "")
    .replace(/[%,()*:"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** First value of a search param. */
export function param(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Positive page number from a search param (defaults to 1). */
export function pageParam(v: string | string[] | undefined): number {
  const n = Number(param(v));
  return Number.isInteger(n) && n > 0 ? Math.min(n, 10000) : 1;
}

/** Relative time for "last updated": "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

/** Current time for server-rendered relative dates (one value per request). */
export function requestNow(): number {
  return Date.now();
}
