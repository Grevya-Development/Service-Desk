import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client (servicedesk schema). Bypasses RLS: only use after
 * checking permissions yourself, and never import from client components.
 */
export function createAdminClient() {
  return createClient<Database, "servicedesk">(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    db: { schema: "servicedesk" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
