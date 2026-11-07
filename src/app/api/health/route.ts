import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Uptime check: app is up and can reach the database. Reveals no data. */
export async function GET() {
  const started = Date.now();
  const { error } = await createAdminClient().from("teams").select("id", { head: true, count: "exact" });
  // On failure, say why in general terms (e.g. an invalid key) — never data or secrets.
  const reason = error
    ? /api key|jwt|apikey|unauthor/i.test(error.message)
      ? "SUPABASE_SERVICE_ROLE_KEY is not a valid key for this project"
      : /header|fetch failed|invalid character/i.test(error.message)
        ? "SUPABASE_SERVICE_ROLE_KEY contains invalid characters (re-paste it without spaces, quotes or line breaks)"
        : `${error.code ? `${error.code}: ` : ""}${error.message}`.replace(/(eyJ|sb_)[\w.-]+/g, "[key]").slice(0, 160) || "query failed"
    : undefined;
  const body = { ok: !error, database: error ? "error" : "ok", reason, latencyMs: Date.now() - started, time: new Date().toISOString() };
  return NextResponse.json(body, { status: error ? 503 : 200, headers: { "cache-control": "no-store" } });
}
