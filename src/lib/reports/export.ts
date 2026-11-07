/** Ticket CSV export rows for /desk/reports/export (pure; unit tested). */
import { PRIORITY_META, STATUS_META, ticketRef } from "@/lib/constants";
import { istDay, resolutionSlaMet, responseSlaMet } from "./aggregate";
import type { CsvValue } from "./csv";

/** Most tickets one export returns. */
export const EXPORT_ROW_CAP = 5000;

/** Columns fetched for the export (PostgREST select with embeds). */
export const EXPORT_SELECT =
  "id, number, subject, status, priority, created_at, first_response_due, first_responded_at, response_breached, resolution_due, resolved_at, resolution_breached, csat_rating, team:teams(name), category:categories(name), requester:people!requester_id(full_name, email), assignee:people!assignee_id(full_name)";

export type ExportTicket = {
  id: string;
  number: number;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  first_response_due: string | null;
  first_responded_at: string | null;
  response_breached: boolean;
  resolution_due: string | null;
  resolved_at: string | null;
  resolution_breached: boolean;
  csat_rating: string | null;
  team: { name: string } | null;
  category: { name: string } | null;
  requester: { full_name: string | null; email: string | null } | null;
  assignee: { full_name: string | null } | null;
};

export const EXPORT_HEADER = [
  "Number",
  "Subject",
  "Team",
  "Category",
  "Priority",
  "Status",
  "Requester",
  "Assignee",
  "Created (IST)",
  "First response at (IST)",
  "Resolved at (IST)",
  "Response SLA met",
  "Resolution SLA met",
  "Rating",
];

const IST_OFFSET_MS = 330 * 60_000;

/** "2026-11-07 14:05" in India time; "" for empty / invalid input. */
export function istDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return `${istDay(t)} ${new Date(t + IST_OFFSET_MS).toISOString().slice(11, 16)}`;
}

const yesNo = (v: boolean | null) => (v === null ? "" : v ? "Yes" : "No");
const label = <T extends Record<string, { label: string }>>(meta: T, key: string) => (Object.hasOwn(meta, key) ? meta[key as keyof T].label : key);
const rating = (r: string | null) => (r === "good" ? "Good" : r === "bad" ? "Bad" : "");

/** One CSV row (cell escaping, incl. formula guards, happens in toCsv). */
export function exportRow(t: ExportTicket): CsvValue[] {
  return [
    ticketRef(t.number),
    t.subject,
    t.team?.name ?? "",
    t.category?.name ?? "",
    label(PRIORITY_META, t.priority),
    label(STATUS_META, t.status),
    t.requester?.full_name ?? t.requester?.email ?? "",
    t.assignee?.full_name ?? "",
    istDateTime(t.created_at),
    istDateTime(t.first_responded_at),
    istDateTime(t.resolved_at),
    yesNo(responseSlaMet(t)),
    yesNo(resolutionSlaMet(t)),
    rating(t.csat_rating),
  ];
}
