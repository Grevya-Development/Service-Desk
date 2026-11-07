/**
 * Applies supabase/migrations/*.sql in order, each in its own transaction.
 * Tracks applied files in servicedesk.schema_migrations (never in
 * supabase_migrations, which belongs to People Success).
 *
 *   npm run db:migrate              # uses SUPABASE_DB_URL from .env.local
 *   SUPABASE_DB_URL=... node scripts/migrate.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("Set SUPABASE_DB_URL");
  process.exit(1);
}
const local = /127\.0\.0\.1|localhost/.test(url);
const sql = postgres(url, { max: 1, ssl: local ? false : "require", onnotice: (n) => console.log("  notice:", n.message) });
const dir = join(import.meta.dirname, "..", "supabase", "migrations");

try {
  await sql.unsafe(`
    create schema if not exists servicedesk;
    create table if not exists servicedesk.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );`);
  const done = new Set((await sql`select name from servicedesk.schema_migrations`).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    process.stdout.write(`Applying ${file} … `);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, file), "utf8"));
      await tx`insert into servicedesk.schema_migrations (name) values (${file})`;
    });
    console.log("done");
    applied++;
  }
  console.log(applied ? `Applied ${applied} migration(s) to ${local ? "LOCAL" : "REMOTE"} database.` : "Database is up to date.");
} catch (e) {
  console.error("\nMigration failed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
