import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ExternalLink, Eye, FileText, Plus, Search, ThumbsUp } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Avatar, Badge, buttonClass, Card, EmptyState, Input, PageHeader, Select, StatCard, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { TeamChip } from "../../kb/_components/team-chip";
import { ARTICLE_STATUS_LABELS, helpfulPercent, isArticleStatus, UUID_RE, type ArticleStatus } from "../../kb/_lib/article";

export const metadata: Metadata = { title: "Manage articles" };

type SP = Record<string, string | string[] | undefined>;
type Filters = { status: ArticleStatus | null; team: string | null; q: string };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Canonical URL (fixed param order, no empty params) so LinkTabs can match the active tab exactly. */
function listHref({ status, team, q }: Filters) {
  const sp = new URLSearchParams();
  if (status) sp.set("status", status);
  if (team) sp.set("team", team);
  if (q) sp.set("q", q);
  const s = sp.toString();
  return s ? `/desk/kb?${s}` : "/desk/kb";
}

export default async function ManageArticlesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireAgent();
  const sp = await searchParams;

  const rawStatus = first(sp.status);
  const rawTeam = first(sp.team);
  const filters: Filters = {
    status: isArticleStatus(rawStatus) ? rawStatus : null,
    team: rawTeam && UUID_RE.test(rawTeam) && me.agentTeamIds.includes(rawTeam) ? rawTeam : null,
    q: (first(sp.q) ?? "").trim().slice(0, 100),
  };
  const canonical = listHref(filters);
  const currentQs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v === undefined ? [] : [[k, v]]))).toString();
  if (canonical !== (currentQs ? `/desk/kb?${currentQs}` : "/desk/kb")) redirect(canonical);

  const supabase = await createClient();
  const teamIds = filters.team ? [filters.team] : me.agentTeamIds;

  let query = supabase
    .from("kb_articles")
    .select("id, slug, title, status, visibility, view_count, updated_at, team_id, author:people!author_id(full_name, avatar_url), feedback:kb_feedback(helpful)")
    .in("team_id", teamIds.length ? teamIds : ["00000000-0000-0000-0000-000000000000"]);
  if (filters.q) query = query.ilike("title", `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

  const [{ data: teamRows }, { data: rows }] = await Promise.all([
    supabase.from("teams").select("id, key, name, color").in("id", me.agentTeamIds).order("sort_order"),
    query.order("updated_at", { ascending: false }).limit(1000),
  ]);
  const teams = teamRows ?? [];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const articles = (rows ?? []).map((a) => {
    const yes = a.feedback.filter((f) => f.helpful).length;
    const no = a.feedback.length - yes;
    return { ...a, yes, no, pct: helpfulPercent(yes, no) };
  });
  const counts = { all: articles.length, draft: 0, published: 0, archived: 0 };
  for (const a of articles) if (isArticleStatus(a.status)) counts[a.status]++;
  const visible = filters.status ? articles.filter((a) => a.status === filters.status) : articles;

  const publishedArticles = articles.filter((a) => a.status === "published");
  const totalViews = publishedArticles.reduce((n, a) => n + a.view_count, 0);
  const totalYes = articles.reduce((n, a) => n + a.yes, 0);
  const totalVotes = articles.reduce((n, a) => n + a.yes + a.no, 0);
  const overallPct = helpfulPercent(totalYes, totalVotes - totalYes);

  const tabs = [
    { label: "All", status: null, count: counts.all },
    { label: "Published", status: "published" as const, count: counts.published },
    { label: "Drafts", status: "draft" as const, count: counts.draft },
    { label: "Archived", status: "archived" as const, count: counts.archived },
  ].map((t) => ({ label: t.label, count: t.count, href: listHref({ ...filters, status: t.status }) }));

  const hasFilters = Boolean(filters.team || filters.q);
  const newHref = filters.team ? `/desk/kb/new?team=${filters.team}` : "/desk/kb/new";

  return (
    <div>
      <PageHeader
        title="Manage articles"
        description="Write and update help articles for your team. Published articles show up in the help center."
        breadcrumbs={[{ label: "Agent workspace", href: "/desk" }, { label: "Articles" }]}
        actions={
          <>
            <Link href="/kb" className={buttonClass("outline")}>
              <BookOpen className="h-4 w-4" aria-hidden />
              Open help center
            </Link>
            <Link href={newHref} className={buttonClass("primary")}>
              <Plus className="h-4 w-4" aria-hidden />
              New article
            </Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Published" value={formatNumber(counts.published)} hint={`${counts.draft} ${counts.draft === 1 ? "draft" : "drafts"} in progress`} icon={FileText} />
        <StatCard label="Views" value={formatNumber(totalViews)} hint="Across published articles" icon={Eye} tone="bg-teal-50 text-teal-600" />
        <StatCard
          label="Found helpful"
          value={overallPct === null ? "—" : `${overallPct}%`}
          hint={totalVotes ? `${formatNumber(totalVotes)} ${totalVotes === 1 ? "vote" : "votes"}` : "No votes yet"}
          icon={ThumbsUp}
          tone="bg-emerald-50 text-emerald-600"
        />
      </div>

      <LinkTabs tabs={tabs} />

      <Card>
        <form action="/desk/kb" method="get" className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          {filters.status && <input type="hidden" name="status" value={filters.status} />}
          {teams.length > 1 && (
            <>
              <label htmlFor="kb-team" className="sr-only">
                Team
              </label>
              <Select id="kb-team" name="team" defaultValue={filters.team ?? ""} className="sm:w-48">
                <option value="">All my teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </>
          )}
          <div className="relative flex-1">
            <label htmlFor="kb-q" className="sr-only">
              Search titles
            </label>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input id="kb-q" name="q" type="search" defaultValue={filters.q} placeholder="Search titles" maxLength={100} className="pl-9" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("secondary")}>
              Apply
            </button>
            {hasFilters && (
              <Link href={listHref({ status: filters.status, team: null, q: "" })} className={buttonClass("ghost")}>
                Clear
              </Link>
            )}
          </div>
        </form>

        {visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={hasFilters ? "No articles match these filters" : filters.status ? `No ${ARTICLE_STATUS_LABELS[filters.status].toLowerCase()} articles` : "No articles yet"}
            description={hasFilters ? "Try another title or team." : "Write the answer to a question people ask often. It saves everyone time."}
            action={
              <Link href={newHref} className={buttonClass("primary")}>
                <Plus className="h-4 w-4" aria-hidden />
                New article
              </Link>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Title</TH>
                <TH>Team</TH>
                <TH>Status</TH>
                <TH>Visible to</TH>
                <TH className="text-right">Views</TH>
                <TH className="text-right">Helpful</TH>
                <TH>Updated</TH>
                <TH>Author</TH>
                <TH>
                  <span className="sr-only">Open</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((a) => {
                const team = teamById.get(a.team_id);
                return (
                  <TR key={a.id}>
                    <TD className="min-w-[16rem] max-w-md">
                      <Link href={`/desk/kb/${a.id}/edit`} className="font-medium text-slate-900 hover:text-primary-700">
                        {a.title}
                      </Link>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">/kb/{a.slug}</p>
                    </TD>
                    <TD>{team ? <TeamChip name={team.name} color={team.color} /> : "—"}</TD>
                    <TD>
                      <StatusBadge status={a.status} label={isArticleStatus(a.status) ? ARTICLE_STATUS_LABELS[a.status] : undefined} />
                    </TD>
                    <TD>{a.visibility === "agents" ? <Badge tone="purple">Agents only</Badge> : <span className="text-xs text-slate-600">Everyone</span>}</TD>
                    <TD className="text-right tabular-nums">{formatNumber(a.view_count)}</TD>
                    <TD className="text-right">
                      {a.pct === null ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <span className="whitespace-nowrap">
                          <span className={cn("font-medium tabular-nums", a.pct >= 70 ? "text-emerald-700" : a.pct >= 40 ? "text-amber-700" : "text-red-700")}>{a.pct}%</span>
                          <span className="ml-1 text-xs text-slate-400">({a.yes + a.no})</span>
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-slate-500">{formatDate(a.updated_at)}</TD>
                    <TD>
                      {a.author?.full_name ? (
                        <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                          <Avatar name={a.author.full_name} src={a.author.avatar_url} size="xs" />
                          {a.author.full_name}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TD>
                    <TD>
                      <Link
                        href={`/kb/${a.slug}`}
                        className="inline-flex rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title={a.status === "published" ? "View in help center" : "Preview"}
                        aria-label={`${a.status === "published" ? "View" : "Preview"} “${a.title}”`}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
