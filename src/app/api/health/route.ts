import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Uptime check: app is up and can reach the database. Reveals no data. */
export async function GET() {
  const started = Date.now();
  const { error } = await createAdminClient().from("teams").select("id", { head: true, count: "exact" });
  // On failure, say why in general terms (e.g. an invalid key) — never data or secrets.
  const reason = error ? (/api key|jwt|apikey/i.test(error.message) ? "invalid service-role key" : error.code || "query failed") : undefined;
  const body = { ok: !error, database: error ? "error" : "ok", reason, latencyMs: Date.now() - started, time: new Date().toISOString() };
  return NextResponse.json(body, { status: error ? 503 : 200, headers: { "cache-control": "no-store" } });
}
