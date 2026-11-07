import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Uptime check: app is up and can reach the database with its service key. Reveals no data. */
export async function GET() {
  const started = Date.now();
  // A normal GET (not head:true) so failures come back with an error body.
  const { error, status } = await createAdminClient().from("teams").select("id").limit(1);
  let reason: string | undefined;
  if (error) {
    const text = `${error.code ? `${error.code}: ` : ""}${error.message ?? ""}`.replace(/(eyJ|sb_)[\w.-]+/g, "[key]").slice(0, 160);
    reason = /api key|jwt|apikey|unauthor/i.test(text) || status === 401
      ? "SUPABASE_SERVICE_ROLE_KEY is not a valid key for this project"
      : text || `HTTP ${status}`;
  }
  const body = { ok: !error, database: error ? "error" : "ok", status, reason, latencyMs: Date.now() - started, time: new Date().toISOString() };
  return NextResponse.json(body, { status: error ? 503 : 200, headers: { "cache-control": "no-store" } });
}
