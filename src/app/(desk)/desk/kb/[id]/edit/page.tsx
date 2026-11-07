import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonClass, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { ArticleEditor } from "../../_components/article-editor";
import { ARTICLE_STATUS_LABELS, helpfulPercent, isArticleStatus, isVisibility, UUID_RE } from "../../../../kb/_lib/article";

export const metadata: Metadata = { title: "Edit article" };

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAgent();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data: article } = await supabase
    .from("kb_articles")
    .select(
      "id, team_id, category_id, title, slug, summary, body, tags, visibility, status, view_count, created_at, updated_at, published_at, author:people!author_id(full_name), editor:people!updated_by(full_name), feedback:kb_feedback(helpful)",
    )
    .eq("id", id)
    .maybeSingle();
  // Agents can read other teams' published articles, but only edit their own team's.
  if (!article || !me.agentTeamIds.includes(article.team_id)) notFound();

  const [{ data: teams }, { data: categories }] = await Promise.all([
    supabase.from("teams").select("id, name, color, active").in("id", me.agentTeamIds).order("sort_order"),
    supabase.from("categories").select("id, name, team_id, active").in("team_id", me.agentTeamIds).order("sort_order"),
  ]);
  // Keep the article's current team / category selectable even if they were deactivated.
  const teamOptions = (teams ?? []).filter((t) => t.active || t.id === article.team_id);
  const categoryOptions = (categories ?? []).filter((c) => c.active || c.id === article.category_id);

  const status = isArticleStatus(article.status) ? article.status : "draft";
  const yes = article.feedback.filter((f) => f.helpful).length;
  const no = article.feedback.length - yes;
  const pct = helpfulPercent(yes, no);

  return (
    <div>
      <PageHeader
        title="Edit article"
        breadcrumbs={[{ label: "Manage articles", href: "/desk/kb" }, { label: article.title }]}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={status} label={ARTICLE_STATUS_LABELS[status]} />
            <span>
              Created by {article.author?.full_name ?? "a former employee"} · {formatDateTime(article.created_at)}
            </span>
            <span>
              Last saved {formatDateTime(article.updated_at)}
              {article.editor?.full_name ? ` by ${article.editor.full_name}` : ""}
            </span>
            <span>{formatNumber(article.view_count)} views</span>
            <span>{pct === null ? "No feedback yet" : `${pct}% found it helpful (${yes + no} ${yes + no === 1 ? "vote" : "votes"})`}</span>
          </span>
        }
        actions={
          <Link href={`/kb/${article.slug}`} className={buttonClass("outline")}>
            <ExternalLink className="h-4 w-4" aria-hidden />
            {status === "published" ? "View article" : "Preview"}
          </Link>
        }
      />
      <ArticleEditor
        article={{
          id: article.id,
          team_id: article.team_id,
          category_id: article.category_id,
          title: article.title,
          slug: article.slug,
          summary: article.summary,
          body: article.body,
          tags: article.tags,
          visibility: isVisibility(article.visibility) ? article.visibility : "everyone",
          status,
        }}
        teams={teamOptions}
        categories={categoryOptions}
        canDelete={me.leadTeamIds.includes(article.team_id)}
      />
    </div>
  );
}
