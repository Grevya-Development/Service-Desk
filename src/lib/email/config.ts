/**
 * Email settings (server only). Set in the hosting environment:
 *   RESEND_API_KEY      required to send (re_…)
 *   EMAIL_FROM          e.g. "Grevya Service Desk <desk@grevya.com>" (domain verified in Resend)
 *   EMAIL_REPLY_TO      optional reply-to address
 *   EMAIL_DEV_ALLOWLIST outside production, only these recipients get mail: comma-separated
 *                       addresses or "*@domain" patterns. Empty = nobody (safe default).
 *   RESEND_API_BASE     optional override (tests)
 */
function read(name: string) {
  return (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "");
}

export const DEFAULT_FROM = "Grevya Service Desk <onboarding@resend.dev>";

export function emailConfig() {
  const apiKey = read("RESEND_API_KEY");
  const from = read("EMAIL_FROM") || DEFAULT_FROM;
  const production = process.env.NODE_ENV === "production" && !read("EMAIL_DEV_ALLOWLIST");
  return {
    apiKey,
    from,
    replyTo: read("EMAIL_REPLY_TO") || undefined,
    apiBase: read("RESEND_API_BASE") || "https://api.resend.com",
    configured: apiKey.length > 0,
    usingSandboxSender: from === DEFAULT_FROM,
    /** In production every recipient is allowed; elsewhere only the allowlist. */
    allowAll: production,
    allowlist: read("EMAIL_DEV_ALLOWLIST")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function recipientAllowed(email: string, cfg = emailConfig()) {
  if (cfg.allowAll) return true;
  const e = email.toLowerCase();
  return cfg.allowlist.some((rule) => (rule.startsWith("*@") ? e.endsWith(rule.slice(1)) : e === rule));
}
