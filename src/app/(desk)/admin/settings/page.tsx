import { BellRing, Clock, Database, Download, Gauge, Link2, Mail, Send, TimerReset } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { Card, CardBody, CardHeader, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ActionButton } from "@/components/ui/action-button";
import { PENDING_LIMITS, TIMEZONES, WEEKDAYS } from "../_lib/validate";
import { importHrHelpdesk, runSlaChecksNow, saveAppUrl, saveAutoClose, saveBusinessHours, savePendingFollowUp, sendQueuedEmailsNow, sendTestEmail } from "./actions";
import { emailConfig } from "@/lib/email/config";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Settings" };

type Hours = { days: number[]; start: string; end: string; timezone: string };
const DEFAULT_HOURS: Hours = { days: [1, 2, 3, 4, 5], start: "09:30", end: "18:30", timezone: "Asia/Kolkata" };

function readHours(v: unknown): Hours {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Partial<Hours>;
  return {
    days: Array.isArray(o.days) ? o.days.filter((d) => Number.isInteger(d)) : DEFAULT_HOURS.days,
    start: typeof o.start === "string" ? o.start : DEFAULT_HOURS.start,
    end: typeof o.end === "string" ? o.end : DEFAULT_HOURS.end,
    timezone: typeof o.timezone === "string" ? o.timezone : DEFAULT_HOURS.timezone,
  };
}

/** A positive whole-number setting, or the fallback. */
function intSetting(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function hoursPerDay(h: Hours) {
  const [sh, sm] = h.start.split(":").map(Number);
  const [eh, em] = h.end.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return mins % 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins / 60}h`;
}

/** ISO timestamp 24 hours ago (outside render for the purity lint rule). */
function dayAgoIso() {
  return new Date(Date.now() - 864e5).toISOString();
}

export default async function AdminSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: rows }, legacy, imported] = await Promise.all([
    supabase.from("settings").select("key, value, updated_at"),
    supabase.schema("public").from("helpdesk_tickets").select("id", { count: "exact", head: true }),
    supabase.from("tickets").select("id", { count: "exact", head: true }).not("legacy_id", "is", null),
  ]);
  const settings = new Map((rows ?? []).map((r) => [r.key, r]));
  const hours = readHours(settings.get("business_hours")?.value);
  const appUrl = typeof settings.get("app_url")?.value === "string" ? (settings.get("app_url")!.value as string) : "";
  const autoClose = intSetting(settings.get("auto_close_days")?.value, 7);
  const remindDays = intSetting(settings.get("pending_reminder_days")?.value, 3);
  const resolveDays = intSetting(settings.get("pending_auto_resolve_days")?.value, 5);
  const lastSla = settings.get("sla_last_run")?.value;
  const lastSlaText = typeof lastSla === "string" && !lastSla.startsWith("1970") ? formatDateTime(lastSla) : "Never";
  const legacyCount = legacy.count ?? 0;
  const importedCount = imported.count ?? 0;
  const remaining = Math.max(0, legacyCount - importedCount);
  const perDay = hoursPerDay(hours);
  const tzKnown = TIMEZONES.some((t) => t.value === hours.timezone);

  // Email status (counts come from the queue; admin already checked above).
  const mail = emailConfig();
  const admin = createAdminClient();
  const since = dayAgoIso();
  const head = { count: "exact" as const, head: true };
  const [qPending, qSent, qFailed, lastFailure] = await Promise.all([
    admin.from("notifications").select("id", head).in("email_status", ["pending", "sending"]),
    admin.from("notifications").select("id", head).eq("email_status", "sent").gte("email_sent_at", since),
    admin.from("notifications").select("id", head).eq("email_status", "failed").gte("created_at", since),
    admin.from("notifications").select("email_error, created_at").eq("email_status", "failed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Desk-wide settings. Only desk admins can see this page." breadcrumbs={[{ label: "Administration" }, { label: "Settings" }]} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="lg:row-span-3">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary-600" />
                Business hours
              </span>
            }
            description="SLA clocks only run during these hours. Public holidays from People Success are skipped automatically."
          />
          <CardBody>
            <ActionForm key={JSON.stringify(hours)} action={saveBusinessHours} resetOnSuccess={false} className="space-y-5">
              <fieldset>
                <legend className="mb-1.5 block text-xs font-medium text-slate-600">Working days</legend>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => (
                    <label key={d.iso} className="cursor-pointer">
                      <input type="checkbox" name="days" value={d.iso} defaultChecked={hours.days.includes(d.iso)} className="peer sr-only" />
                      <span
                        className="inline-flex h-9 min-w-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 transition peer-checked:border-primary-600 peer-checked:bg-primary-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-1"
                        title={d.label}
                      >
                        {d.short}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Day starts" htmlFor="bh-start" required>
                  <Input id="bh-start" name="start" type="time" defaultValue={hours.start} required />
                </Field>
                <Field label="Day ends" htmlFor="bh-end" required>
                  <Input id="bh-end" name="end" type="time" defaultValue={hours.end} required />
                </Field>
              </div>
              <Field label="Time zone" htmlFor="bh-tz" required>
                <Select id="bh-tz" name="timezone" defaultValue={tzKnown ? hours.timezone : "Asia/Kolkata"}>
                  {TIMEZONES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                Right now: <strong>{perDay ?? "?"}</strong> a day, {hours.days.length} day{hours.days.length === 1 ? "" : "s"} a week. A 4-hour target on a ticket raised
                an hour before closing is due 3 working hours into the next working day. Changes apply to new tickets and to tickets whose SLA is recalculated; existing due
                times are not moved.
              </div>
              <div className="flex justify-end">
                <SubmitButton>Save business hours</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary-600" />
                Service Desk address
              </span>
            }
            description="Requesters also get desk notifications in People Success. Their links point here."
          />
          <CardBody>
            <ActionForm key={appUrl} action={saveAppUrl} resetOnSuccess={false} className="space-y-4">
              <Field
                label="Web address of this desk"
                htmlFor="app-url"
                hint="The address people open the Service Desk at, e.g. https://desk.grevya.com (no slash at the end). Leave empty to send notifications without links."
              >
                <Input id="app-url" name="app_url" type="url" inputMode="url" defaultValue={appUrl} placeholder="https://desk.grevya.com" maxLength={200} />
              </Field>
              <div className="flex justify-end">
                <SubmitButton>Save address</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <TimerReset className="h-4 w-4 text-primary-600" />
                Auto-close
              </span>
            }
            description="Resolved tickets close by themselves after this many days. Until then, the requester can reopen them."
          />
          <CardBody>
            <ActionForm key={autoClose} action={saveAutoClose} resetOnSuccess={false} className="flex flex-wrap items-end gap-3">
              <Field label="Close resolved tickets after (days)" htmlFor="auto-close" className="w-56">
                <Input id="auto-close" name="auto_close_days" type="number" min={1} max={60} step={1} defaultValue={autoClose} required />
              </Field>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-primary-600" />
                Waiting on the requester
              </span>
            }
            description="When a ticket is pending a reply from the requester, the desk nudges them and then tidies up. Days count working days only."
          />
          <CardBody>
            <ActionForm key={`${remindDays}-${resolveDays}`} action={savePendingFollowUp} resetOnSuccess={false} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Remind requesters after (working days)" htmlFor="pending-remind" hint={`1 to ${PENDING_LIMITS.reminderMax}.`}>
                  <Input id="pending-remind" name="pending_reminder_days" type="number" min={1} max={PENDING_LIMITS.reminderMax} step={1} defaultValue={remindDays} required />
                </Field>
                <Field label="Resolve automatically after (working days)" htmlFor="pending-resolve" hint={`More than the reminder, up to ${PENDING_LIMITS.resolveMax}.`}>
                  <Input id="pending-resolve" name="pending_auto_resolve_days" type="number" min={2} max={PENDING_LIMITS.resolveMax} step={1} defaultValue={resolveDays} required />
                </Field>
              </div>
              <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                Right now: after <strong>{remindDays}</strong> working day{remindDays === 1 ? "" : "s"} without a reply the requester gets a reminder; after{" "}
                <strong>{resolveDays}</strong> (counted from when the ticket started waiting) it is marked resolved, and they can still reopen it for {autoClose} day
                {autoClose === 1 ? "" : "s"}.
              </p>
              <div className="flex justify-end">
                <SubmitButton>Save</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-primary-600" />
                Email notifications
              </span>
            }
            description="Every desk notification is also emailed (via Resend). People can turn emails off from their account menu."
          />
          <CardBody className="space-y-4">
            {!mail.configured ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Not set up yet. Add <code>RESEND_API_KEY</code> (and <code>EMAIL_FROM</code> with your verified domain) in the hosting environment, then redeploy.
                Notifications are queued meanwhile and go out once it&apos;s set.
              </p>
            ) : mail.usingSandboxSender ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Sending from Resend&apos;s test address, which only delivers to your own Resend account email. Verify your domain in Resend and set{" "}
                <code>EMAIL_FROM</code> (e.g. <code>Grevya Service Desk &lt;desk@grevya.com&gt;</code>).
              </p>
            ) : null}
            {!appUrl && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Set the <strong>Service Desk address</strong> above so emails go out within seconds and their buttons link to the right page.
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 py-2">
                <dt className="text-[11px] text-slate-500">Status</dt>
                <dd className={`text-sm font-semibold ${mail.configured ? "text-emerald-700" : "text-amber-700"}`}>{mail.configured ? "On" : "Not set up"}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 py-2">
                <dt className="text-[11px] text-slate-500">Waiting to send</dt>
                <dd className="text-lg font-semibold text-slate-900">{qPending.count ?? 0}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 py-2">
                <dt className="text-[11px] text-slate-500">Sent (24h)</dt>
                <dd className="text-lg font-semibold text-slate-900">{qSent.count ?? 0}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 py-2">
                <dt className="text-[11px] text-slate-500">Failed (24h)</dt>
                <dd className={`text-lg font-semibold ${(qFailed.count ?? 0) > 0 ? "text-red-700" : "text-slate-900"}`}>{qFailed.count ?? 0}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">
              From: <span className="font-medium text-slate-700">{mail.from}</span>
              {lastFailure.data?.email_error && (
                <>
                  {" "}· Last failure: <span className="text-red-700">{lastFailure.data.email_error}</span>
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton action={sendTestEmail} variant="primary" size="md">
                <Send className="h-4 w-4" />
                Send me a test email
              </ActionButton>
              <ActionButton action={sendQueuedEmailsNow} variant="outline" size="md">
                <Mail className="h-4 w-4" />
                Send queued emails now
              </ActionButton>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Database className="h-4 w-4 text-primary-600" />
                Data
              </span>
            }
            description="One-off and maintenance jobs."
          />
          <CardBody className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700">
                  <Download className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-800">Import HR Helpdesk tickets</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    Copies tickets and comments from the old People Success HR Helpdesk into the HR team. Safe to run again: tickets already copied are skipped, and
                    the old tickets are left untouched.
                  </p>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">In People Success</dt>
                  <dd className="text-lg font-semibold text-slate-900">{legacyCount}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Already imported</dt>
                  <dd className="text-lg font-semibold text-slate-900">{importedCount}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <dt className="text-[11px] text-slate-500">Waiting</dt>
                  <dd className={`text-lg font-semibold ${remaining ? "text-orange-700" : "text-emerald-700"}`}>{remaining}</dd>
                </div>
              </dl>
              <div className="mt-auto">
                <ActionButton
                  action={importHrHelpdesk}
                  variant="primary"
                  size="md"
                  confirm={`Import ${remaining || "any new"} HR Helpdesk ticket${remaining === 1 ? "" : "s"} into the HR team?`}
                >
                  <Download className="h-4 w-4" />
                  Import HR Helpdesk tickets
                </ActionButton>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <Gauge className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-800">Run SLA checks now</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    Marks overdue tickets, sends &quot;due soon&quot; and &quot;overdue&quot; alerts, and closes resolved tickets past the auto-close window. This
                    already runs every few minutes; use it if something looks stuck.
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Last run: <span className="font-medium text-slate-700">{lastSlaText}</span>
              </p>
              <div className="mt-auto">
                <ActionButton action={runSlaChecksNow} variant="outline" size="md" confirm="Run SLA checks now?">
                  <Gauge className="h-4 w-4" />
                  Run SLA checks now
                </ActionButton>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
