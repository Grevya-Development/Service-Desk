import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { dispatchPendingEmails, dispatchSecret } from "@/lib/email/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Allowed callers: the database ping (x-dispatch-secret) or Vercel Cron (Bearer CRON_SECRET). */
async function authorised(req: NextRequest) {
  const cron = (process.env.CRON_SECRET ?? "").trim();
  const auth = req.headers.get("authorization") ?? "";
  if (cron && same(auth, `Bearer ${cron}`)) return true;
  const given = req.headers.get("x-dispatch-secret") ?? "";
  if (!given) return false;
  const secret = await dispatchSecret();
  return Boolean(secret && same(given, secret));
}

async function handle(req: NextRequest) {
  if (!(await authorised(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const stats = await dispatchPendingEmails();
    return NextResponse.json({ ok: true, ...stats }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Dispatch failed" }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
