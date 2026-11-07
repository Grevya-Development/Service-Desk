import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * SLA checks (breaches, at-risk warnings, auto-close). Called by Vercel Cron
 * with `Authorization: Bearer $CRON_SECRET`. pg_cron also runs this every
 * 5 minutes when available, and the agent queue triggers it opportunistically.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("run_sla_checks");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, changed: data });
}
