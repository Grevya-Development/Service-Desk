import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

/**
 * Supabase client bound to the signed-in user's session (RLS applies).
 * Defaults to the `servicedesk` schema; use `.schema("public")` for People Success tables.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database, "servicedesk">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "servicedesk" },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: the proxy refreshes the session instead.
          }
        },
      },
    },
  );
}

export type DeskClient = Awaited<ReturnType<typeof createClient>>;
