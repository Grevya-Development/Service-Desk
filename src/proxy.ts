import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth", "/api/cron", "/api/health", "/api/email/dispatch"];

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** Plain-text page naming missing settings (never their values) instead of a bare 500. */
function missingConfig() {
  const missing = REQUIRED_ENV.filter((k) => !(process.env[k] ?? "").trim());
  if (!missing.length) return null;
  return new NextResponse(
    `Service Desk is not configured yet.\n\nMissing environment variable(s): ${missing.join(", ")}\n\n` +
      "Add them in Vercel → Project → Settings → Environment Variables (Production), then redeploy.\n",
    { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } },
  );
}

type Flagged = { app_metadata?: unknown; user_metadata?: unknown };
/** HR's "choose your own password" flag (app_metadata; user_metadata for accounts flagged before that). */
function mustChangePassword(u: Flagged | null | undefined) {
  return (
    (u?.app_metadata as { must_change_password?: boolean } | undefined)?.must_change_password === true ||
    (u?.user_metadata as { must_change_password?: boolean } | undefined)?.must_change_password === true
  );
}

/**
 * The token's copy of the flag can be stale: the password may have been changed in the other Grevya
 * app (each app has its own session). Only for flagged tokens, ask Supabase Auth for the current user.
 * - Flag gone: refresh the session (new cookies go out on the response) and let them through.
 * - Session gone (changing a password signs out the user's other sessions): sign out here too.
 */
async function passwordFlagState(supabase: ReturnType<typeof createServerClient>): Promise<"change" | "ok" | "signed_out"> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    if (error.status === 401 || error.status === 403 || error.name === "AuthSessionMissingError") {
      await supabase.auth.signOut({ scope: "local" });
      return "signed_out";
    }
    return "change";
  }
  if (!data.user || mustChangePassword(data.user)) return "change";
  await supabase.auth.refreshSession();
  return "ok";
}

/** Redirect while keeping any auth cookies the Supabase client just set on `from`. */
function redirectWith(from: NextResponse, url: URL) {
  const res = NextResponse.redirect(url);
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

export async function proxy(request: NextRequest) {
  const misconfigured = missingConfig();
  if (misconfigured) return misconfigured;

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims() refreshes an expired session and verifies the JWT locally
  // (no network call to Supabase Auth on every request).
  const { data: auth } = await supabase.auth.getClaims();
  const user = auth?.claims?.sub ? auth.claims : null;

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Keep the query string too (e.g. /requests/new?team=it) so deep links survive sign-in.
    const target = path + request.nextUrl.search;
    url.search = path && path !== "/" ? `?next=${encodeURIComponent(target)}` : "";
    return NextResponse.redirect(url);
  }
  // A temporary password set by HR (People Success): choose your own before using the desk.
  // app_metadata can only be written by the service role; user_metadata covers older accounts.
  if (user && mustChangePassword(user) && !path.startsWith("/auth") && !path.startsWith("/api/")) {
    const state = await passwordFlagState(supabase);
    if (state !== "ok") {
      const url = request.nextUrl.clone();
      url.pathname = state === "signed_out" ? "/login" : "/auth/reset";
      url.search = state === "signed_out" ? "" : "?first=1";
      return redirectWith(response, url);
    }
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
