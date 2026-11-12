"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { DESK_MODE_COOKIE, type DeskMode } from "@/lib/desk-mode";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function markNotificationRead(id: string) {
  if (typeof id !== "string" || !UUID_RE.test(id)) return;
  const me = await getViewer();
  if (!me) return;
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const me = await getViewer();
  if (!me) return;
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("employee_id", me.id).is("read_at", null);
  revalidatePath("/", "layout");
}

/** Agents: mark yourself away (auto-assign skips you) or available again. */
export async function setAway(away: boolean) {
  const me = await getViewer();
  if (!me || !me.isAgent) return { ok: false as const, error: "Only agents can set availability" };
  const supabase = await createClient();
  const { error } = await supabase.from("agent_profiles").upsert({ employee_id: me.id, away: Boolean(away), away_until: null });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Turn notification emails on or off for yourself. */
export async function setEmailNotifications(enabled: boolean) {
  const me = await getViewer();
  if (!me) return { ok: false as const, error: "Not signed in" };
  const supabase = await createClient();
  const { error } = await supabase.from("notification_preferences").upsert({ employee_id: me.id, email_enabled: Boolean(enabled) });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Desk admins: open the admin console (console-only menu, overview dashboard). */
export async function openAdminConsole() {
  const me = await getViewer();
  if (!me) redirect("/login");
  if (!me.isAdmin) redirect("/home?denied=1");
  await setMode("admin");
  redirect("/admin");
}

/** Desk admins: switch to the help center everyone else sees, to raise or follow their own requests. */
export async function openMyRequests() {
  const me = await getViewer();
  if (!me) redirect("/login");
  if (me.isAdmin) await setMode("self");
  redirect("/home");
}

async function setMode(mode: DeskMode) {
  const store = await cookies();
  store.set(DESK_MODE_COOKIE, mode, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
