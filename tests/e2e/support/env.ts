import fs from "node:fs";
import path from "node:path";

/** Load .env.local into process.env (without overriding values already set). */
export function loadEnv() {
  const file = path.resolve(__dirname, "../../../.env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

/** The suite resets demo data, so it must only ever point at the local stack. */
export function assertLocalDatabase() {
  const url = process.env.SUPABASE_DB_URL ?? "";
  const api = process.env.SUPABASE_URL ?? "";
  const local = (u: string) => /127\.0\.0\.1|localhost/.test(u);
  if (!local(url) || !local(api)) {
    throw new Error("E2E tests reset demo data and must run against the local Supabase stack (.env.local). Refusing to continue.");
  }
}
