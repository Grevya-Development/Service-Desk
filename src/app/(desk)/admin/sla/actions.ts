"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { PRIORITIES, PRIORITY_META } from "@/lib/constants";
import { formatTarget } from "@/lib/sla";
import { str } from "@/lib/utils";
import { guardLead } from "../_lib/access";
import { SLA_LIMITS } from "../_lib/validate";

function minutes(fd: FormData, key: string) {
  const v = str(fd, key);
  if (v === null || !/^\d+$/.test(v)) return null;
  return Number(v);
}

/** Saves all four priority rows for a team in one upsert. Values arrive in business minutes. */
export async function saveSla(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const teamId = str(fd, "team_id");
  const g = await guardLead(teamId);
  if (g.error !== undefined) return fail(g.error);

  const rows = [];
  for (const p of PRIORITIES) {
    const label = PRIORITY_META[p].label;
    const fr = minutes(fd, `${p}_first_response`);
    const res = minutes(fd, `${p}_resolution`);
    if (fr === null || res === null) return fail(`${label}: enter both targets as whole numbers.`);
    if (fr < 1 || fr > SLA_LIMITS.firstResponse) return fail(`${label}: first response must be between 1 minute and ${formatTarget(SLA_LIMITS.firstResponse)}.`);
    if (res < 1 || res > SLA_LIMITS.resolution) return fail(`${label}: resolution must be between 1 minute and ${formatTarget(SLA_LIMITS.resolution)}.`);
    if (res < fr) return fail(`${label}: resolution can't be shorter than first response.`);
    rows.push({ team_id: teamId!, priority: p, first_response_mins: fr, resolution_mins: res });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sla_policies").upsert(rows, { onConflict: "team_id,priority" });
  if (error) return fail(dbError(error));
  revalidatePath("/admin/sla");
  return ok("SLA targets saved. They apply to new tickets and whenever a ticket's priority changes.");
}
