import { Clock, Database, Download, Gauge, Link2, TimerReset } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { Card, CardBody, CardHeader, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ActionButton } from "@/components/ui/action-button";
import { TIMEZONES, WEEKDAYS } from "../_lib/validate";
import { importHrHelpdesk, runSlaChecksNow, saveAppUrl, saveAutoClose, saveBusinessHours } from "./actions";

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

function hoursPerDay(h: Hours) {
  const [sh, sm] = h.start.split(":").map(Number);
  const [eh, em] = h.end.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return mins % 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins / 60}h`;
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
  const autoCloseRaw = Number(settings.get("auto_close_days")?.value);
  const autoClose = Number.isInteger(autoCloseRaw) && autoCloseRaw > 0 ? autoCloseRaw : 7;
  const lastSla = settings.get("sla_last_run")?.value;
  const lastSlaText = typeof lastSla === "string" && !lastSla.startsWith("1970") ? formatDateTime(lastSla) : "Never";
  const legacyCount = legacy.count ?? 0;
  const importedCount = imported.count ?? 0;
  const remaining = Math.max(0, legacyCount - importedCount);
  const perDay = hoursPerDay(hours);
  const tzKnown = TIMEZONES.some((t) => t.value === hours.timezone);

  return (
    <>
      <PageHeader title="Settings" description="Desk-wide settings. Only desk admins can see this page." breadcrumbs={[{ label: "Administration" }, { label: "Settings" }]} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="lg:row-span-2">
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
            <ActionForm action={saveBusinessHours} resetOnSuccess={false} className="space-y-5">
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
            <ActionForm action={saveAppUrl} resetOnSuccess={false} className="space-y-4">
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
            <ActionForm action={saveAutoClose} resetOnSuccess={false} className="flex flex-wrap items-end gap-3">
              <Field label="Close resolved tickets after (days)" htmlFor="auto-close" className="w-56">
                <Input id="auto-close" name="auto_close_days" type="number" min={1} max={60} step={1} defaultValue={autoClose} required />
              </Field>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
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
