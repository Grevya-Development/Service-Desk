"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import type { Json } from "@/lib/database.types";
import { str } from "@/lib/utils";
import { guardAdmin } from "../_lib/access";
import { emailConfig, recipientAllowed } from "@/lib/email/config";
import { renderNotificationEmail } from "@/lib/email/template";
import { sendEmail } from "@/lib/email/resend";
import { dispatchPendingEmails } from "@/lib/email/dispatch";
import { PENDING_LIMITS, TIME_RE, TIMEZONES, normalizeAppUrl } from "../_lib/validate";

async function saveSettings(values: Record<string, NonNullable<Json>>): Promise<ActionState> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const rows = Object.entries(values).map(([key, value]) => ({ key, value, updated_at: now }));
  const { data, error } = await supabase.from("settings").upsert(rows).select("key");
  if (error) return fail(dbError(error));
  if ((data?.length ?? 0) < rows.length) return fail("You don't have permission to change settings.");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/sla");
  return null;
}

const saveSetting = (key: string, value: NonNullable<Json>) => saveSettings({ [key]: value });

/** Whole number from a form field, or null. */
function wholeNumber(fd: FormData, key: string): number | null {
  const v = str(fd, key) ?? "";
  return /^\d{1,3}$/.test(v) ? Number(v) : null;
}

export async function saveBusinessHours(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardAdmin();
  if (g.error !== undefined) return fail(g.error);

  const raw = fd.getAll("days").map(String);
  if (raw.some((d) => !/^[1-7]$/.test(d))) return fail("Pick working days from the list.");
  const days = [...new Set(raw.map(Number))].sort((a, b) => a - b);
  if (!days.length) return fail("Pick at least one working day.");
  const start = str(fd, "start") ?? "";
  const end = str(fd, "end") ?? "";
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return fail("Enter start and end times like 09:30.");
  if (end <= start) return fail("The working day must end after it starts.");
  const timezone = str(fd, "timezone") ?? "";
  if (!TIMEZONES.some((t) => t.value === timezone)) return fail("Pick a time zone from the list.");

  const res = await saveSetting("business_hours", { days, start, end, timezone });
  return res ?? ok("Business hours saved. New SLA due times use them.");
}

export async function saveAppUrl(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardAdmin();
  if (g.error !== undefined) return fail(g.error);
  const raw = str(fd, "app_url");
  let url = "";
  if (raw) {
    if (raw.length > 200) return fail("That address is too long.");
    const normalized = normalizeAppUrl(raw);
    if (!normalized) return fail("Enter a full web address starting with https://, e.g. https://desk.grevya.com");
    url = normalized;
  }
  const res = await saveSetting("app_url", url);
  return res ?? ok(url ? `Links in People Success will open ${url}` : "Address cleared. People Success notifications won't link to the desk.");
}

export async function saveAutoClose(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardAdmin();
  if (g.error !== undefined) return fail(g.error);
  const v = str(fd, "auto_close_days") ?? "";
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 60) return fail("Enter a whole number of days from 1 to 60.");
  const res = await saveSetting("auto_close_days", Number(v));
  return res ?? ok(`Resolved tickets now close after ${v} day${v === "1" ? "" : "s"}`);
}

/** Reminder after N working days waiting on the requester; auto-resolve after M (> N). */
export async function savePendingFollowUp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardAdmin();
  if (g.error !== undefined) return fail(g.error);
  const remind = wholeNumber(fd, "pending_reminder_days");
  const resolve = wholeNumber(fd, "pending_auto_resolve_days");
  if (remind === null || remind < 1 || remind > PENDING_LIMITS.reminderMax) return fail(`Send the reminder after 1 to ${PENDING_LIMITS.reminderMax} working days.`);
  if (resolve === null || resolve > PENDING_LIMITS.resolveMax) return fail(`Resolve automatically after up to ${PENDING_LIMITS.resolveMax} working days.`);
  if (resolve <= remind) return fail("Resolve automatically must come after the reminder. Pick a larger number of days.");
  const res = await saveSettings({ pending_reminder_days: remind, pending_auto_resolve_days: resolve });
  return res ?? ok(`Requesters get a reminder after ${remind} working day${remind === 1 ? "" : "s"}; the ticket resolves after ${resolve}.`);
}

export async function importHrHelpdesk(): Promise<ActionState> {
  const g = await guardAdmin();
  if (g.error !== undefined) return fail(g.error);
  // import_hr_helpdesk() is not callable by signed-in users, so use the service-role client (admin checked above).
  const { data, error } = await createAdminClient().rpc("import_hr_helpdesk");
  if (error) return fail(dbError(error, "The import failed."));
  revalidatePath("/admin/settings");
  const n = data ?? 0;
  return ok(n ? `Imported ${n} ticket${n === 1 ? "" : "s"}` : "Nothing new to import: every HR Helpdesk ticket is already here.");
}

export async function runSlaChecksNow(): Promise<ActionState> {
  const g = await guardAdmin();
  if (g.error !== undefined) return fail(g.error);
  const { data, error } = await createAdminClient().rpc("run_sla_checks");
  if (error) return fail(dbError(error, "SLA checks failed."));
  revalidatePath("/admin/settings");
  const n = data ?? 0;
  return ok(n ? `SLA checks done: ${n} ticket update${n === 1 ? "" : "s"}` : "SLA checks done: nothing needed attention");
}

/** Send a test email to the signed-in admin, straight through Resend (not the queue). */
export async function sendTestEmail(): Promise<ActionState> {
  const g = await guardAdmin();
  if (g.error !== undefined) return fail(g.error);
  const cfg = emailConfig();
  if (!cfg.configured) return fail("Email isn't set up: add RESEND_API_KEY in the hosting environment and redeploy.");
  if (!recipientAllowed(g.me.email, cfg)) return fail(`${g.me.email} isn't in EMAIL_DEV_ALLOWLIST (needed outside production).`);
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "app_url").maybeSingle();
  const base = typeof data?.value === "string" && data.value ? data.value.replace(/\/+$/, "") : null;
  const mail = renderNotificationEmail({
    recipientName: g.me.name,
    title: "Test email from the Service Desk",
    body: "If you can read this, email notifications are working. People will get an email like this when their requests change.",
    url: base ? `${base}/home` : null,
    deskUrl: base,
  });
  const res = await sendEmail({ to: g.me.email, ...mail, tags: [{ name: "kind", value: "test" }] }, `test-${g.me.id}-${Date.now()}`);
  if (!res.ok) return fail(`Resend didn't accept it: ${res.error}`);
  return ok(`Test email sent to ${g.me.email}`);
}

/** Send whatever is queued right now (normally automatic within seconds). */
export async function sendQueuedEmailsNow(): Promise<ActionState> {
  const g = await guardAdmin();
  if (g.error !== undefined) return fail(g.error);
  try {
    const s = await dispatchPendingEmails();
    revalidatePath("/admin/settings");
    if (!s.configured) return fail("Email isn't set up: add RESEND_API_KEY and redeploy.");
    return ok(s.claimed ? `Sent ${s.sent}, retrying ${s.retrying}, failed ${s.failed}, skipped ${s.skipped}` : "Nothing waiting to send");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Sending failed");
  }
}
