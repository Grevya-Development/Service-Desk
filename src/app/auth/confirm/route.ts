import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["recovery", "invite", "magiclink", "email", "email_change", "signup"];

/**
 * Landing point for links in Supabase auth emails
 * (…/auth/confirm?token_hash=…&type=recovery&next=/auth/reset).
 * Verifies the one-time token on the server, so the link works on any device.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? (type === "recovery" || type === "invite" ? "/auth/reset" : "/home");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/home";

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
