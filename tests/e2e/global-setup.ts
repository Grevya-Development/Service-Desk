import { execSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { assertLocalDatabase, loadEnv } from "./support/env";

/**
 * Start every run from known demo data:
 *  - `npm run db:seed` resets desk demo data (tickets, incidents, catalog, articles…) on the LOCAL stack only;
 *  - settings the suite edits and restores are put back in case an earlier run was interrupted.
 */
export default async function globalSetup() {
  loadEnv();
  assertLocalDatabase();
  const root = path.resolve(__dirname, "../..");
  execSync("npm run db:seed", { cwd: root, stdio: "inherit" });

  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 1, onnotice: () => {} });
  try {
    // Leftovers from interrupted admin tests (seed doesn't touch categories, SLA targets or business hours).
    await sql`delete from servicedesk.categories c where c.name like 'E2E %'
                and not exists (select 1 from servicedesk.tickets t where t.category_id = c.id)`;
    await sql`update servicedesk.sla_policies set first_response_mins = d.fr, resolution_mins = d.res
              from (values ('urgent', 30, 240), ('high', 60, 480), ('medium', 240, 1440), ('low', 480, 2400)) as d(p, fr, res)
              where priority = d.p`;
    await sql`update servicedesk.settings set value = ${sql.json({ end: "18:30", days: [1, 2, 3, 4, 5], start: "09:30", timezone: "Asia/Kolkata" })}
              where key = 'business_hours'`;
  } finally {
    await sql.end();
  }
}
