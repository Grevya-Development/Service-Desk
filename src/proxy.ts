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
