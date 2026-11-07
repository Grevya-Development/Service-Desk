import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfig, recipientAllowed } from "./config";
import { renderNotificationEmail } from "./template";
import { sendBatch, type OutgoingEmail } from "./resend";
import { MAX_ATTEMPTS, backoffMinutes } from "./retry";


async function deskUrl(): Promise<string | null> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "app_url").maybeSingle();
  const v = typeof data?.value === "string" ? data.value.trim().replace(/\/+$/, "") : "";
  return v || null;
}

export type DispatchStats = { configured: boolean; claimed: number; sent: number; retrying: number; failed: number; skipped: number };

/**
 * Send queued notification emails: claim a batch, render, send through Resend, record results.
 * Safe to run concurrently and repeatedly (rows are claimed with SKIP LOCKED; sends carry
 * idempotency keys). Runs up to `rounds` batches.
 */
export async function dispatchPendingEmails({ batchSize = 50, rounds = 3 } = {}): Promise<DispatchStats> {
  const cfg = emailConfig();
  const stats: DispatchStats = { configured: cfg.configured, claimed: 0, sent: 0, retrying: 0, failed: 0, skipped: 0 };
  // Without a key, leave everything queued (no attempts burned) until it's configured.
  if (!cfg.configured) return stats;

  const admin = createAdminClient();
  const base = await deskUrl();

  for (let round = 0; round < rounds; round++) {
    const { data: rows, error } = await admin.rpc("claim_email_batch", { p_limit: batchSize });
    if (error) throw new Error(`Could not claim emails: ${error.message}`);
    if (!rows?.length) break;
    stats.claimed += rows.length;

    const allowed = rows.filter((r) => recipientAllowed(r.email, cfg));
    const blocked = rows.filter((r) => !recipientAllowed(r.email, cfg));
    if (blocked.length) {
      await admin
        .from("notifications")
        .update({ email_status: "skipped", email_error: "Recipient not in EMAIL_DEV_ALLOWLIST (non-production)" })
        .in("id", blocked.map((r) => r.id));
      stats.skipped += blocked.length;
    }
    if (!allowed.length) continue;

    const emails: OutgoingEmail[] = allowed.map((r) => {
      const link = r.link ? (/^https?:\/\//i.test(r.link) ? r.link : base ? `${base}${r.link.startsWith("/") ? "" : "/"}${r.link}` : null) : null;
      const { subject, html, text } = renderNotificationEmail({ recipientName: r.full_name, title: r.title, body: r.body, url: link, deskUrl: base });
      return { to: r.email, subject, html, text, tags: [{ name: "kind", value: "notification" }] };
    });
    const key = "notif-" + createHash("sha256").update(allowed.map((r) => `${r.id}:${r.attempts}`).join(",")).digest("hex").slice(0, 40);
    const results = await sendBatch(emails, key);

    const now = new Date();
    await Promise.all(
      allowed.map((r, i) => {
        const res = results[i];
        if (res.ok) {
          stats.sent++;
          return admin.from("notifications").update({ email_status: "sent", email_sent_at: now.toISOString(), email_id: res.id, email_error: null }).eq("id", r.id);
        }
        const giveUp = !res.retryable || r.attempts >= MAX_ATTEMPTS;
        if (giveUp) stats.failed++;
        else stats.retrying++;
        const waitMin = Math.max(backoffMinutes(r.attempts), Math.ceil((res.retryAfterSec ?? 0) / 60));
        return admin
          .from("notifications")
          .update({
            email_status: giveUp ? "failed" : "pending",
            email_error: res.error,
            email_next_at: new Date(now.getTime() + waitMin * 60_000).toISOString(),
          })
          .eq("id", r.id);
      }),
    );
    // Stop early if Resend is rate limiting or down; the next ping retries.
    if (results.some((r) => !r.ok && r.retryable)) break;
  }
  return stats;
}

/** The shared secret the database sends with its "send now" ping. */
export async function dispatchSecret(): Promise<string | null> {
  const { data } = await createAdminClient().from("private_settings").select("value").eq("key", "email_dispatch_secret").maybeSingle();
  return data?.value ?? null;
}
