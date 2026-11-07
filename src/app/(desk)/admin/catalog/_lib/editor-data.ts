import "server-only";
import type { Viewer } from "@/lib/auth";
import type { DeskClient } from "@/lib/supabase/server";
import { loadLeadTeams } from "../../_lib/data";
import type { EditorCategory, EditorTeam } from "../_components/catalog-editor";

/** Teams the viewer leads + their categories, for the catalog editor. */
export async function loadEditorData(supabase: DeskClient, me: Viewer): Promise<{ teams: EditorTeam[]; categories: EditorCategory[] }> {
  const teams = await loadLeadTeams(supabase, me);
  if (!teams.length) return { teams: [], categories: [] };
  const { data } = await supabase
    .from("categories")
    .select("id, team_id, name, active")
    .in(
      "team_id",
      teams.map((t) => t.id),
    )
    .order("sort_order")
    .order("name");
  return { teams: teams.map((t) => ({ id: t.id, name: t.name, color: t.color })), categories: data ?? [] };
}
