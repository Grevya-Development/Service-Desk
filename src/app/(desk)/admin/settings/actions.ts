"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import type { Json } from "@/lib/database.types";
import { str } from "@/lib/utils";
import { guardAdmin } from "../_lib/access";
import { TIME_RE, TIMEZONES, normalizeAppUrl } from "../_lib/validate";

async function saveSetting(key: string, value: NonNullable<Json>): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").upsert({ key, value, updated_at: new Date().toISOString() }).select("key");
  if (error) return fail(dbError(error));
  if (!data?.length) return fail("You don't have permission to change settings.");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/sla");
  return null;
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
