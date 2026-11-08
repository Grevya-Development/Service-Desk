import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * SLA checks (breaches, at-risk warnings, auto-close). Called by Vercel Cron
 * with `Authorization: Bearer $CRON_SECRET`. pg_cron also runs this every
 * 5 minutes when available, and the agent queue triggers it opportunistically.
 */
export async function GET(req: NextRequest) {
  // Trimmed like the email dispatch route: a secret pasted with a stray newline must still match.
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret || !same(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("run_sla_checks");
  if (error) {
    console.error("SLA cron failed:", error.message);
    return NextResponse.json({ ok: false, error: "SLA checks failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, changed: data }, { headers: { "cache-control": "no-store" } });
}
