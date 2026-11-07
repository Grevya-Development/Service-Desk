"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str } from "@/lib/utils";
import {
  BODY_MAX,
  isArticleStatus,
  isVisibility,
  parseTags,
  SLUG_MAX,
  SLUG_RE,
  SUMMARY_MAX,
  TAG_MAX_LENGTH,
  TAGS_MAX,
  TITLE_MAX,
  TITLE_MIN,
  UUID_RE,
} from "../../kb/_lib/article";

const SAVED_MESSAGE = { draft: "Draft saved", published: "Article published", archived: "Article archived" } as const;

/** Create (no id) or update (id) an article. Agents can write for their own teams only. */
export async function saveArticle(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  if (!me.isAgent) return fail("Only agents can write articles");

  const id = str(fd, "id");
  if (id && !UUID_RE.test(id)) return fail("Article not found");

  const teamId = str(fd, "team_id");
  if (!teamId || !UUID_RE.test(teamId)) return fail("Choose a team");
  if (!me.agentTeamIds.includes(teamId)) return fail("You can only write articles for your own team");

  const categoryId = str(fd, "category_id");
  if (categoryId && !UUID_RE.test(categoryId)) return fail("Choose a valid category");

  const title = str(fd, "title");
  if (!title) return fail("Add a title");
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) return fail(`The title must be ${TITLE_MIN}–${TITLE_MAX} characters`);

  const slug = (str(fd, "slug") ?? "").toLowerCase();
  if (!slug) return fail("Add a web address (slug) for the article");
  if (slug.length > SLUG_MAX) return fail(`The web address must be ${SLUG_MAX} characters or fewer`);
  if (!SLUG_RE.test(slug)) return fail("The web address can only use lowercase letters, numbers and single dashes (e.g. reset-vpn-password)");

  const summary = str(fd, "summary");
  if (summary && summary.length > SUMMARY_MAX) return fail(`Keep the summary to ${SUMMARY_MAX} characters or fewer`);

  const rawBody = fd.get("body");
  const body = typeof rawBody === "string" ? rawBody.replace(/\r\n?/g, "\n").replace(/\s+$/, "") : "";
  if (body.length > BODY_MAX) return fail("The article is too long. Split it into smaller articles.");

  const tags = parseTags(str(fd, "tags"));
  if (tags.length > TAGS_MAX) return fail(`Use at most ${TAGS_MAX} tags`);
  if (tags.some((t) => t.length > TAG_MAX_LENGTH)) return fail(`Each tag must be ${TAG_MAX_LENGTH} characters or fewer`);

  const visibility = str(fd, "visibility") ?? "everyone";
  if (!isVisibility(visibility)) return fail("Choose who can see the article");
  const status = str(fd, "status") ?? "draft";
  if (!isArticleStatus(status)) return fail("Choose a status");
  if (status === "published" && !body.trim()) return fail("Write the article before publishing it");

  const supabase = await createClient();

  if (categoryId) {
    const { data: cat } = await supabase.from("categories").select("id").eq("id", categoryId).eq("team_id", teamId).maybeSingle();
    if (!cat) return fail("That category doesn't belong to the selected team");
  }

  const values = { team_id: teamId, category_id: categoryId, title, slug, summary, body, tags, visibility, status };
  let previousSlug: string | null = null;
  let saved: { id: string; slug: string; status: string } | null = null;

  if (id) {
    const { data: existing } = await supabase.from("kb_articles").select("slug, team_id").eq("id", id).maybeSingle();
    if (!existing || !me.agentTeamIds.includes(existing.team_id)) return fail("Article not found, or you can't edit it");
    previousSlug = existing.slug;
    const { data, error } = await supabase.from("kb_articles").update(values).eq("id", id).select("id, slug, status").maybeSingle();
    if (error) return fail(saveError(error));
    if (!data) return fail("You don't have permission to edit this article");
    saved = data;
  } else {
    const { data, error } = await supabase.from("kb_articles").insert(values).select("id, slug, status").single();
    if (error) return fail(saveError(error));
    saved = data;
  }

  revalidatePath("/kb");
  revalidatePath("/desk/kb");
  revalidatePath(`/kb/${saved.slug}`);
  if (previousSlug && previousSlug !== saved.slug) revalidatePath(`/kb/${previousSlug}`);

  const message = isArticleStatus(saved.status) ? SAVED_MESSAGE[saved.status] : "Saved";
  return ok(message, saved.status === "published" ? `/kb/${saved.slug}` : `/desk/kb/${saved.id}/edit`);
}

/** Team leads (and admins) can delete an article for good. */
export async function deleteArticle(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const id = str(fd, "id");
  if (!id || !UUID_RE.test(id)) return fail("Article not found");

  const supabase = await createClient();
  const { data: article } = await supabase.from("kb_articles").select("id, slug, team_id").eq("id", id).maybeSingle();
  if (!article) return fail("Article not found");
  if (!me.leadTeamIds.includes(article.team_id)) return fail("Only team leads can delete articles. You can archive it instead.");

  const { data, error } = await supabase.from("kb_articles").delete().eq("id", id).select("id");
  if (error) return fail(dbError(error));
  if (!data?.length) return fail("You don't have permission to delete this article");

  revalidatePath("/kb");
  revalidatePath("/desk/kb");
  revalidatePath(`/kb/${article.slug}`);
  return ok("Article deleted", "/desk/kb");
}

function saveError(error: { message: string; code?: string }) {
  if (error.code === "23505") return "That URL is already used by another article. Try a different web address.";
  return dbError(error);
}
