"use server";

import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str } from "@/lib/utils";
import { UUID_RE } from "./_lib/article";

/**
 * "Was this helpful?" vote. One vote per employee per article; voting again changes it.
 * No revalidatePath on purpose: re-rendering the article page would count another view.
 */
export async function voteHelpful(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const articleId = str(fd, "article_id");
  const vote = str(fd, "helpful");
  if (!articleId || !UUID_RE.test(articleId)) return fail("Article not found");
  if (vote !== "yes" && vote !== "no") return fail("Choose yes or no");

  const supabase = await createClient();
  // Only accept votes on articles this person can actually read (RLS decides).
  const { data: article } = await supabase.from("kb_articles").select("id").eq("id", articleId).maybeSingle();
  if (!article) return fail("Article not found");

  const { error } = await supabase
    .from("kb_feedback")
    .upsert({ article_id: articleId, employee_id: me.id, helpful: vote === "yes" }, { onConflict: "article_id,employee_id" });
  if (error) return fail(dbError(error));
  return ok("Thanks for your feedback");
}
