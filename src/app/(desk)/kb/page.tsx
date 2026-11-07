import Link from "next/link";
import { BookOpen, LifeBuoy, Search, SearchX } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonClass, Card, CardHeader, EmptyState } from "@/components/ui";
import { cn, formatDate } from "@/lib/utils";
import { ArticleCard, CARD_COLUMNS, type CardArticle, type CardTeam } from "./_components/article-card";
import { TeamChip } from "./_components/team-chip";
import { safeColor, UUID_RE } from "./_lib/article";

export const metadata = { title: "Knowledge base" };

type SP = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function kbHref(params: { q?: string | null; team?: string | null; category?: string | null }) {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.team) sp.set("team", params.team);
  if (params.category) sp.set("category", params.category);
  const s = sp.toString();
  return s ? `/kb?${s}` : "/kb";
}

export default async function KnowledgeBasePage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireViewer();
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").trim().slice(0, 120);
  const teamKey = first(sp.team) ?? null;
  const rawCategory = first(sp.category) ?? null;

  const supabase = await createClient();
  const [{ data: teamRows }, { data: categoryRows }, { data: index }] = await Promise.all([
    supabase.from("teams").select("id, key, name, color").eq("active", true).order("sort_order"),
    supabase.from("categories").select("id, name, team_id").eq("active", true).order("sort_order"),
    supabase.from("kb_articles").select("id, team_id, category_id").eq("status", "published").limit(5000),
  ]);
  const teams: CardTeam[] = teamRows ?? [];
  const categories = categoryRows ?? [];
  const published = index ?? [];

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const team = teams.find((t) => t.key === teamKey) ?? null;
  const category = team && rawCategory && UUID_RE.test(rawCategory) ? (categories.find((c) => c.id === rawCategory && c.team_id === team.id) ?? null) : null;

  const teamCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  for (const a of published) {
    teamCounts.set(a.team_id, (teamCounts.get(a.team_id) ?? 0) + 1);
    if (a.category_id) categoryCounts.set(a.category_id, (categoryCounts.get(a.category_id) ?? 0) + 1);
  }
  const teamCategories = team ? categories.filter((c) => c.team_id === team.id && (categoryCounts.get(c.id) ?? 0) > 0) : [];

  const mode: "search" | "browse" | "home" = q ? "search" : team ? "browse" : "home";
  let results: CardArticle[] = [];
  let popular: CardArticle[] = [];
  let recent: CardArticle[] = [];

  if (mode === "search") {
    let query = supabase.rpc("search_articles", { q, lim: 20 }).select(CARD_COLUMNS);
    if (team) query = query.eq("team_id", team.id);
    if (category) query = query.eq("category_id", category.id);
    const { data } = await query;
    results = data ?? [];
  } else if (mode === "browse" && team) {
    let query = supabase.from("kb_articles").select(CARD_COLUMNS).eq("status", "published").eq("team_id", team.id);
    if (category) query = query.eq("category_id", category.id);
    const { data } = await query.order("view_count", { ascending: false }).order("title").limit(60);
    results = data ?? [];
  } else {
    const [pop, rec] = await Promise.all([
      supabase.from("kb_articles").select(CARD_COLUMNS).eq("status", "published").order("view_count", { ascending: false }).order("updated_at", { ascending: false }).limit(6),
      supabase.from("kb_articles").select(CARD_COLUMNS).eq("status", "published").order("updated_at", { ascending: false }).limit(6),
    ]);
    popular = pop.data ?? [];
    recent = rec.data ?? [];
  }

  const reportHref = team ? `/requests/new?team=${encodeURIComponent(team.key)}` : "/requests/new";
  const scopeLabel = category ? `${team?.name} · ${category.name}` : team?.name;

  return (
    <div className="space-y-6">
      {/* Hero search */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 via-navy-700 to-primary-600 px-5 py-8 text-white shadow-sm sm:px-10 sm:py-12">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-24 h-56 w-56 rounded-full bg-white/5" />
        <div className="relative mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Knowledge base</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{me.firstName ? `How can we help, ${me.firstName}?` : "How can we help?"}</h1>
          <p className="mt-2 text-sm text-white/75">Search our help articles for quick answers, or browse by team.</p>
          <form action="/kb" method="get" role="search" className="mt-6 flex flex-col gap-2 sm:flex-row">
            {team && <input type="hidden" name="team" value={team.key} />}
            <label htmlFor="kb-search" className="sr-only">
              Search help articles
            </label>
            <div className="relative flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="kb-search"
                name="q"
                type="search"
                defaultValue={q}
                maxLength={120}
                placeholder="e.g. reset my password, payslip, VPN"
                autoComplete="off"
                className="h-12 w-full rounded-xl border-0 bg-white pl-10 pr-4 text-sm text-slate-800 shadow-lg placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-white/30"
              />
            </div>
            <button type="submit" className="h-12 rounded-xl bg-white/15 px-6 text-sm font-semibold text-white ring-1 ring-inset ring-white/30 transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              Search
            </button>
          </form>
          {team && (
            <p className="mt-3 text-xs text-white/70">
              Searching in {team.name} only.{" "}
              <Link href={kbHref({ q })} className="font-medium text-white underline underline-offset-2">
                Search all teams
              </Link>
            </p>
          )}
        </div>
      </section>

      {/* Browse by team / category */}
      {teams.length > 0 && (
        <nav aria-label="Browse by team" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-500">Browse</span>
            <Link
              href={kbHref({ q })}
              aria-current={!team ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors",
                !team ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
              )}
            >
              All teams <span className={cn("text-[0.85em] font-semibold", !team ? "text-white/70" : "text-slate-400")}>{published.length}</span>
            </Link>
            {teams.map((t) => (
              <TeamChip key={t.id} name={t.name} color={t.color} size="md" href={kbHref({ q, team: t.key })} count={teamCounts.get(t.id) ?? 0} active={team?.id === t.id} />
            ))}
          </div>
          {team && teamCategories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-l-2 pl-3" style={{ borderColor: safeColor(team.color) }}>
              <CategoryPill href={kbHref({ q, team: team.key })} active={!category} label={`All ${team.name}`} />
              {teamCategories.map((c) => (
                <CategoryPill key={c.id} href={kbHref({ q, team: team.key, category: c.id })} active={category?.id === c.id} label={c.name} count={categoryCounts.get(c.id)} />
              ))}
            </div>
          )}
        </nav>
      )}

      {mode !== "home" && (
        <section aria-labelledby="kb-results" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="kb-results" className="text-lg font-semibold text-slate-900">
              {mode === "search" ? (
                <>
                  {results.length === 0 ? "No results" : `${results.length}${results.length === 20 ? "+" : ""} ${results.length === 1 ? "result" : "results"}`} for “{q}”
                  {scopeLabel && <span className="font-normal text-slate-500"> in {scopeLabel}</span>}
                </>
              ) : (
                <>{scopeLabel} articles</>
              )}
            </h2>
            {mode === "search" && (
              <Link href={kbHref({ team: team?.key, category: category?.id })} className="text-sm font-medium text-primary-600 hover:text-primary-700">
                Clear search
              </Link>
            )}
          </div>
          {results.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((a) => (
                <ArticleCard key={a.id} article={a} team={teamById.get(a.team_id)} categoryName={a.category_id ? categoryName.get(a.category_id) : null} />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={mode === "search" ? SearchX : BookOpen}
                title={mode === "search" ? `We couldn't find anything for “${q}”` : "No articles here yet"}
                description={
                  mode === "search"
                    ? "Try fewer or different words, or check the spelling. Still need help? Let us know and we'll sort it out."
                    : "Our team hasn't written any help for this yet. Still need help? Let us know and we'll sort it out."
                }
                action={
                  <Link href={reportHref} className={buttonClass("primary")}>
                    <LifeBuoy className="h-4 w-4" aria-hidden />
                    Report an issue
                  </Link>
                }
              />
            </Card>
          )}
        </section>
      )}

      {mode === "home" &&
        (popular.length === 0 ? (
          <Card>
            <EmptyState
              icon={BookOpen}
              title="No help articles yet"
              description="Our teams are still writing them. In the meantime, report an issue and we'll help you directly."
              action={
                <Link href="/requests/new" className={buttonClass("primary")}>
                  <LifeBuoy className="h-4 w-4" aria-hidden />
                  Report an issue
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section aria-labelledby="kb-popular" className="space-y-3 lg:col-span-2">
              <h2 id="kb-popular" className="text-lg font-semibold text-slate-900">
                Popular articles
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {popular.map((a) => (
                  <ArticleCard key={a.id} article={a} team={teamById.get(a.team_id)} categoryName={a.category_id ? categoryName.get(a.category_id) : null} />
                ))}
              </div>
            </section>
            <section aria-labelledby="kb-recent">
              <Card>
                <CardHeader title={<span id="kb-recent">Recently updated</span>} />
                <ul className="divide-y divide-slate-100">
                  {recent.map((a) => {
                    const t = teamById.get(a.team_id);
                    return (
                      <li key={a.id}>
                        <Link href={`/kb/${a.slug}`} className="group flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: safeColor(t?.color) }} />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-slate-800 group-hover:text-primary-700">{a.title}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {t ? `${t.name} · ` : ""}Updated {formatDate(a.updated_at)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          </div>
        ))}

      {/* Still need help? */}
      {(mode === "home" ? popular.length > 0 : results.length > 0) && (
        <Card className="flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
              <LifeBuoy className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800">Still need help?</p>
              <p className="mt-0.5 text-sm text-slate-500">Can&apos;t find what you&apos;re looking for? Tell us what&apos;s wrong and someone will get back to you.</p>
            </div>
          </div>
          <Link href={reportHref} className={buttonClass("primary", "md", "shrink-0")}>
            Report an issue
          </Link>
        </Card>
      )}
    </div>
  );
}

function CategoryPill({ href, label, count, active }: { href: string; label: string; count?: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-primary-600 text-white" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50",
      )}
    >
      {label}
      {typeof count === "number" && <span className={active ? "text-white/75" : "text-slate-400"}>{count}</span>}
    </Link>
  );
}
