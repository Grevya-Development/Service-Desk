import type { NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rangeBounds } from "@/lib/reports/aggregate";
import { toCsv } from "@/lib/reports/csv";
import { EXPORT_HEADER, EXPORT_ROW_CAP, EXPORT_SELECT, exportRow, type ExportTicket } from "@/lib/reports/export";
import { orgToday } from "@/lib/utils";
import { pageAll, parseRange, reportTeamIds } from "../_lib/load";

/**
 * GET /desk/reports/export?team=&range= | from=&to= → CSV of the tickets raised
 * in the range for the team (or all the viewer's teams), up to 5,000 rows.
 * Same access as the reports page: agents, for their own teams (RLS applies too).
 */
export async function GET(request: NextRequest) {
  const me = await getViewer();
  if (!me) return new Response("Please sign in again.", { status: 401 });
  if (!me.isAgent) return new Response("Only agents can export tickets.", { status: 403 });

  const sp = request.nextUrl.searchParams;
  const params = Object.fromEntries([...sp.keys()].map((k) => [k, sp.get(k) ?? undefined]));
  const range = parseRange(params, orgToday());
  const teamIds = reportTeamIds(me.agentTeamIds, params.team);
  if (teamIds.length === 0) return new Response("You're not on a team yet.", { status: 403 });

  const supabase = await createClient();
  const { start, end } = rangeBounds(range.from, range.to);
  const result = await pageAll<ExportTicket>(
    (from, to) =>
      supabase
        .from("tickets")
        .select(EXPORT_SELECT)
        .in("team_id", teamIds)
        .gte("created_at", start)
        .lt("created_at", end)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    EXPORT_ROW_CAP,
  );
  if (result.error) return new Response("We couldn't export the tickets. Try again.", { status: 500 });

  let scope = "all-teams";
  if (teamIds.length === 1) {
    const { data: team } = await supabase.from("teams").select("key").eq("id", teamIds[0]).maybeSingle();
    scope = team?.key?.replace(/[^a-z0-9_-]/gi, "") || "team";
  }

  // BOM so Excel opens UTF-8 names correctly.
  return new Response("﻿" + toCsv(EXPORT_HEADER, result.rows.map(exportRow)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tickets-${scope}-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "no-store",
      "X-Row-Count": String(result.rows.length),
      ...(result.capped ? { "X-Truncated": "true" } : {}),
    },
  });
}
