"use server";

import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ArticleHit = { id: string; slug: string; title: string; summary: string | null; team_id: string };

/** Published articles matching `q` (prefix search, ranked). Used for suggestions while typing a ticket. */
export async function searchArticles(q: string, limit = 5): Promise<ArticleHit[]> {
  const me = await getViewer();
  if (!me) return [];
  const term = (q ?? "").trim().slice(0, 120);
  if (term.length < 3) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("search_articles", { q: term, lim: Math.min(Math.max(limit, 1), 20), any_term: true }).select("id, slug, title, summary, team_id");
  return (data ?? []) as ArticleHit[];
}
