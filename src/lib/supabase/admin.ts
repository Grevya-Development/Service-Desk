import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";

/**
 * Service-role client (servicedesk schema). Bypasses RLS: only use after
 * checking permissions yourself, and never import from client components.
 */
export function createAdminClient() {
  return createClient<Database, "servicedesk">(env.supabaseUrl, env.supabaseServiceRoleKey, {
    db: { schema: "servicedesk" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
