import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Eye, FileText, LifeBuoy, Lock, Pencil, Tag } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Markdown, excerpt } from "@/components/markdown";
import { Avatar, Badge, buttonClass, Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/utils";
import { CARD_COLUMNS, type CardArticle } from "../_components/article-card";
import { HelpfulVote } from "../_components/helpful-vote";
import { TeamChip } from "../_components/team-chip";
import { ARTICLE_STATUS_LABELS, isArticleStatus, safeColor, SLUG_RE } from "../_lib/article";

type Params = Promise<{ slug: string }>;

const ARTICLE_SELECT =
  "id, slug, title, summary, body, tags, status, visibility, view_count, team_id, category_id, published_at, updated_at, created_at, team:teams(id, key, name, color), category:categories(id, name), author:people!author_id(full_name, avatar_url), editor:people!updated_by(full_name)" as const;

/** One fetch per request, shared by generateMetadata and the page. RLS hides what the viewer may not read. */
const loadArticle = cache(async (slug: string) => {
  if (!SLUG_RE.test(slug)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("kb_articles").select(ARTICLE_SELECT).eq("slug", slug).maybeSingle();
  return data;
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadArticle(slug);
  return article ? { title: article.title, description: article.summary ?? excerpt(article.body, 160) } : { title: "Article not found" };
}

export default async function ArticlePage({ params }: { params: Params }) {
  const me = await requireViewer();
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) notFound();

  const supabase = await createClient();
  const isTeamAgent = me.agentTeamIds.includes(article.team_id);
  const head = { count: "exact" as const, head: true };

  const [, myVote, yes, no, related] = await Promise.all([
    supabase.rpc("record_article_view", { p_id: article.id }),
    supabase.from("kb_feedback").select("helpful").eq("article_id", article.id).eq("employee_id", me.id).maybeSingle(),
    me.isAgent ? supabase.from("kb_feedback").select("article_id", head).eq("article_id", article.id).eq("helpful", true) : Promise.resolve({ count: null }),
    me.isAgent ? supabase.from("kb_feedback").select("article_id", head).eq("article_id", article.id).eq("helpful", false) : Promise.resolve({ count: null }),
    supabase
      .from("kb_articles")
      .select(CARD_COLUMNS)
      .eq("status", "published")
      .eq("team_id", article.team_id)
      .neq("id", article.id)
      .order("view_count", { ascending: false })
      .limit(12),
  ]);

  // Same category first, then the team's most-read articles.
  const relatedArticles: CardArticle[] = (related.data ?? [])
    .map((a, i) => ({ a, rank: (article.category_id && a.category_id === article.category_id ? 0 : 1) * 100 + i }))
    .sort((x, y) => x.rank - y.rank)
    .slice(0, 4)
    .map((x) => x.a);

  const team = article.team;
  const teamKey = team?.key ?? "";
  const reportHref = teamKey ? `/requests/new?team=${encodeURIComponent(teamKey)}` : "/requests/new";
  const counts = me.isAgent ? { yes: yes.count ?? 0, no: no.count ?? 0 } : null;
  const status = isArticleStatus(article.status) ? article.status : "draft";
  const updatedBy = article.editor?.full_name ?? article.author?.full_name ?? null;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Knowledge base", href: "/kb" },
          ...(team ? [{ label: team.name, href: `/kb?team=${encodeURIComponent(team.key)}` }] : []),
          ...(team && article.category ? [{ label: article.category.name, href: `/kb?team=${encodeURIComponent(team.key)}&category=${article.category.id}` }] : []),
        ]}
        title={<span className="block max-w-3xl text-balance leading-tight">{article.title}</span>}
        actions={
          isTeamAgent ? (
            <Link href={`/desk/kb/${article.id}/edit`} className={buttonClass("outline")}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit article
            </Link>
          ) : undefined
        }
        description={
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            {team && <TeamChip name={team.name} color={team.color} href={`/kb?team=${encodeURIComponent(team.key)}`} />}
            {article.category && team && (
              <Link href={`/kb?team=${encodeURIComponent(team.key)}&category=${article.category.id}`} className="text-xs font-medium text-slate-600 hover:text-primary-600">
                {article.category.name}
              </Link>
            )}
            {isTeamAgent && status !== "published" && <StatusBadge status={status} label={ARTICLE_STATUS_LABELS[status]} />}
            {article.visibility === "agents" && (
              <Badge tone="purple" className="gap-1">
                <Lock className="h-3 w-3" aria-hidden /> Agents only
              </Badge>
            )}
          </span>
        }
      />

      {isTeamAgent && status !== "published" && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            {status === "draft" ? "This is a draft." : "This article is archived."} Only {team?.name ?? "team"} agents can see it. Publish it from the editor to show it in the help center.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="overflow-hidden">
          <div aria-hidden className="h-1" style={{ backgroundColor: safeColor(team?.color) }} />
          <article className="px-5 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 pb-5 text-xs text-slate-500">
              {article.author?.full_name && (
                <span className="inline-flex items-center gap-2">
                  <Avatar name={article.author.full_name} src={article.author.avatar_url} size="xs" />
                  <span>
                    Written by <span className="font-medium text-slate-700">{article.author.full_name}</span>
                  </span>
                </span>
              )}
              <span>
                Updated {formatDate(article.updated_at)}
                {updatedBy && updatedBy !== article.author?.full_name ? ` by ${updatedBy}` : ""}
              </span>
              {me.isAgent && (
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" aria-hidden /> {formatNumber(article.view_count)} views
                </span>
              )}
            </div>

            {article.summary && <p className="mt-6 text-base leading-relaxed text-slate-600 sm:text-[17px]">{article.summary}</p>}

            {article.body.trim() ? (
              <Markdown source={article.body} className="prose-doc mt-4 max-w-[72ch] text-[15px] leading-7" />
            ) : (
              <p className="mt-6 text-sm italic text-slate-400">This article doesn&apos;t have any content yet.</p>
            )}

            {article.tags.length > 0 && (
              <div className="mt-8 flex flex-wrap items-center gap-2">
                <Tag className="h-3.5 w-3.5 text-slate-400" aria-label="Tags" />
                {article.tags.map((t) => (
                  <Link
                    key={t}
                    href={`/kb?q=${encodeURIComponent(t)}`}
                    className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-primary-50 hover:text-primary-700"
                  >
                    #{t}
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-8">
              <HelpfulVote key={article.id} articleId={article.id} initialVote={myVote.data?.helpful ?? null} initialCounts={counts} reportHref={reportHref} />
            </div>
          </article>
        </Card>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Related articles" />
            {relatedArticles.length ? (
              <ul className="divide-y divide-slate-100">
                {relatedArticles.map((a) => (
                  <li key={a.id}>
                    <Link href={`/kb/${a.slug}`} className="group block px-5 py-3 hover:bg-slate-50">
                      <span className="block text-sm font-medium text-slate-800 group-hover:text-primary-700">{a.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{a.summary?.trim() || excerpt(a.body, 100)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-slate-500">No related articles yet.</p>
            )}
            {team && (
              <div className="border-t border-slate-100 px-5 py-3">
                <Link href={`/kb?team=${encodeURIComponent(team.key)}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700">
                  All {team.name} articles <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 text-primary-600">
              <LifeBuoy className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-800">Still need help?</p>
            <p className="mt-1 text-sm text-slate-500">Tell {team ? `the ${team.name} team` : "us"} what&apos;s going on and someone will get back to you.</p>
            <Link href={reportHref} className={buttonClass("primary", "md", "mt-4 w-full")}>
              Report an issue
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
