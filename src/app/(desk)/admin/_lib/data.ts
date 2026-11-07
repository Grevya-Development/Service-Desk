import "server-only";
import type { Viewer } from "@/lib/auth";
import type { DeskClient } from "@/lib/supabase/server";

export type LeadTeam = { id: string; key: string; name: string; color: string; icon: string; active: boolean };

/** Teams the viewer can manage (all teams for admins), in display order. */
export async function loadLeadTeams(supabase: DeskClient, me: Viewer): Promise<LeadTeam[]> {
  if (!me.leadTeamIds.length) return [];
  const { data } = await supabase
    .from("teams")
    .select("id, key, name, color, icon, active")
    .in("id", me.leadTeamIds)
    .order("sort_order")
    .order("name");
  return data ?? [];
}
