"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { bool, str } from "@/lib/utils";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Incident banner: "I'm affected — notify me" on / off for the signed-in employee. */
export async function setIncidentAffected(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const id = str(fd, "incident_id");
  if (!id || !UUID_RE.test(id)) return fail("We couldn't find that incident.");
  const on = bool(fd, "on");

  const supabase = await createClient();
  const { data: incident } = await supabase.from("incidents").select("id, status").eq("id", id).maybeSingle();
  if (!incident) return fail("We couldn't find that incident. It may have been removed.");

  if (on) {
    if (incident.status === "resolved") return fail("Good news: this one is already fixed.");
    const { error } = await supabase
      .from("incident_subscribers")
      .upsert({ incident_id: id, employee_id: me.id }, { onConflict: "incident_id,employee_id", ignoreDuplicates: true });
    if (error) return fail(dbError(error));
  } else {
    const { error } = await supabase.from("incident_subscribers").delete().eq("incident_id", id).eq("employee_id", me.id);
    if (error) return fail(dbError(error));
  }

  for (const p of ["/home", "/requests/new", "/catalog", "/status"]) revalidatePath(p);
  return ok(on ? "Thanks. We'll let you know as soon as it's fixed." : "Okay, you won't get updates for this one.");
}
