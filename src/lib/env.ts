/**
 * Server-side settings, trimmed: values pasted into a hosting dashboard often carry a stray
 * space, quote or line break, which breaks HTTP headers in a way that's hard to spot.
 */
function read(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "");
}

export const env = {
  get supabaseUrl() {
    return read("SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return read("SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return read("SUPABASE_SERVICE_ROLE_KEY");
  },
};
