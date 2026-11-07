import type { NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { APPROVAL_META, PRIORITY_META, STATUS_META, isPriority, isStatus, ticketRef } from "@/lib/constants";
import { toCsv } from "@/lib/reports/csv";
import { primarySla } from "@/lib/sla";
import { orgToday } from "@/lib/utils";
import { fetchQueueRows, loadQueueContext } from "../_lib/context";

const EXPORT_LIMIT = 5000;

/** Timestamps in the organisation's time zone, in a format spreadsheets parse ("2026-11-07 14:05"). */
const stamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

/** GET /desk/export?view=…&filters → CSV of the queue view the agent is looking at (up to 5,000 rows). */
export async function GET(request: NextRequest) {
  const me = await getViewer();
  if (!me) return new Response("Please sign in again.", { status: 401 });
  if (!me.isAgent) return new Response("Only support agents can export tickets.", { status: 403 });

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const supabase = await createClient();
  const { teamIds, teams, categories, params } = await loadQueueContext(supabase, me, sp);
  const { rows, error, clock } = await fetchQueueRows(supabase, params, teamIds, me.id, { limit: EXPORT_LIMIT, chunk: 1000 });
  if (error) return new Response(`Could not export tickets: ${error}`, { status: 500 });

  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const csv = toCsv(
    [
      "Ticket",
      "Subject",
      "Team",
      "Status",
      "Priority",
      "Category",
      "Requester",
      "Requester email",
      "Department",
      "Assignee",
      "Approval",
      "SLA",
      "First response due",
      "First responded",
      "Resolution due",
      "Resolved",
      "Created",
      "Updated",
    ],
    rows.map((t) => [
      ticketRef(t.number),
      t.subject,
      teamName.get(t.team_id) ?? "",
      isStatus(t.status) ? STATUS_META[t.status].label : t.status,
      isPriority(t.priority) ? PRIORITY_META[t.priority].label : t.priority,
      t.category_id ? (categoryName.get(t.category_id) ?? "") : "",
      t.requester?.full_name ?? "Former employee",
      t.requester?.email ?? "",
      t.requester?.department ?? "",
      t.assignee?.full_name ?? "",
      t.approval_status && t.approval_status !== "not_required" ? (APPROVAL_META[t.approval_status]?.label ?? t.approval_status) : "",
      primarySla(t, clock.now).label,
      stamp(t.first_response_due),
      stamp(t.first_responded_at),
      stamp(t.resolution_due),
      stamp(t.resolved_at),
      stamp(t.created_at),
      stamp(t.updated_at),
    ]),
  );

  // BOM so Excel opens UTF-8 (names, “quotes”) correctly.
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tickets-${params.view}-${orgToday()}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
