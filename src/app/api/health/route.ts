import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfig } from "@/lib/email/config";
import { env } from "@/lib/env";

/**
 * Describe a Supabase key without revealing it: its format and, for JWT keys, the
 * non-secret role and project ref from the payload. Helps spot "pasted the anon key" mistakes.
 */
function describeKey(key: string, expectedRef: string | null) {
  if (!key) return "missing";
  if (key.startsWith("sb_secret_")) return "new-style secret key (sb_secret_…)";
  if (key.startsWith("sb_publishable_")) return "publishable key (sb_publishable_…) — this is not the service-role key";
  const parts = key.split(".");
  if (parts.length !== 3) return `not a recognised key format (${key.length} characters)`;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: string; ref?: string };
    const ref = payload.ref ?? "?";
    const refNote = expectedRef && ref !== expectedRef ? ` — belongs to project ${ref}, but SUPABASE_URL is project ${expectedRef}` : "";
    return `JWT key with role "${payload.role ?? "?"}"${payload.role === "service_role" ? "" : " — expected \"service_role\""}${refNote}`;
  } catch {
    return "JWT-shaped but unreadable";
  }
}

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
  const expectedRef = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.supabaseUrl)?.[1] ?? null;
  const serviceKey = error ? describeKey(env.supabaseServiceRoleKey, expectedRef) : undefined;
  const body = { ok: !error, database: error ? "error" : "ok", status, reason, serviceKey, email: emailConfig().configured ? "configured" : "not configured", latencyMs: Date.now() - started, time: new Date().toISOString() };
  return NextResponse.json(body, { status: error ? 503 : 200, headers: { "cache-control": "no-store" } });
}
