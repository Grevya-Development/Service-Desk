import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardList, Search, SearchX, Ticket } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { ApprovalBadge, TicketStatusBadge } from "@/components/tickets/badges";
import { ticketRef } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { TeamChip } from "../requests/_components/team-chip";
import { param, parseTicketNumber, requestNow, sanitizeSearch, timeAgo } from "../requests/_lib/query";

export const metadata: Metadata = { title: "Search" };

type Hit = {
  id: string;
  number: number;
  subject: string;
  status: string;
  approval_status: string;
  updated_at: string;
  team_id: string;
  requester_id: string;
  team: { name: string; color: string } | null;
  requester: { full_name: string | null } | null;
};

const HIT_SELECT = "id, number, subject, status, approval_status, updated_at, team_id, requester_id, team:teams(name, color), requester:people!requester_id(full_name)";

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireViewer();
  const sp = await searchParams;
  const q = param(sp.q).trim().slice(0, 120);
  const number = parseTicketNumber(q);
  const safe = sanitizeSearch(q);
  const supabase = await createClient();
  const now = requestNow();

  /** Agents of the ticket's team work it in the desk; everyone else uses the requester view. */
  const hrefFor = (t: Pick<Hit, "number" | "team_id" | "requester_id">) =>
    t.requester_id !== me.id && me.agentTeamIds.includes(t.team_id) ? `/desk/tickets/${t.number}` : `/requests/${t.number}`;

  let exact: Hit | null = null;
  let mine: Hit[] = [];
  let team: Hit[] = [];
  let articles: { id: string; slug: string; title: string; summary: string | null; team_id: string }[] = [];
  let teamNames = new Map<string, { name: string; color: string }>();

  if (q) {
    const canSearchText = safe.length >= 2;
    const [exactRes, mineRes, teamRes, articleRes, teamsRes] = await Promise.all([
      number ? supabase.from("tickets").select(HIT_SELECT).eq("number", number).maybeSingle() : Promise.resolve({ data: null }),
      canSearchText
        ? supabase.from("tickets").select(HIT_SELECT).eq("requester_id", me.id).ilike("subject", `%${safe}%`).order("updated_at", { ascending: false }).limit(20)
        : Promise.resolve({ data: [] }),
      canSearchText && me.isAgent && me.agentTeamIds.length
        ? supabase
            .from("tickets")
            .select(HIT_SELECT)
            .in("team_id", me.agentTeamIds)
            .neq("requester_id", me.id)
            .ilike("subject", `%${safe}%`)
            .order("updated_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      supabase.rpc("search_articles", { q: q, lim: 10 }).select("id, slug, title, summary, team_id"),
      supabase.from("teams").select("id, name, color"),
    ]);
    exact = (exactRes.data as unknown as Hit | null) ?? null;
    mine = ((mineRes.data ?? []) as unknown as Hit[]).filter((t) => t.id !== exact?.id);
    team = ((teamRes.data ?? []) as unknown as Hit[]).filter((t) => t.id !== exact?.id);
    articles = (articleRes.data ?? []) as typeof articles;
    teamNames = new Map((teamsRes.data ?? []).map((t) => [t.id, { name: t.name, color: t.color }]));
  }

  const total = (exact ? 1 : 0) + mine.length + team.length + articles.length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Search" breadcrumbs={[{ label: "Home", href: "/home" }, { label: "Search" }]} />

      <form action="/search" method="get" role="search" className="mb-6">
        <label htmlFor="search-q" className="sr-only">
          Search
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              id="search-q"
              name="q"
              type="search"
              defaultValue={q}
              autoFocus={!q}
              placeholder={me.isAgent ? "Ticket number (SD-1042), subject or help article" : "Help articles or your requests (e.g. SD-1042)"}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <button type="submit" className={buttonClass("primary", "lg")}>
            Search
          </button>
        </div>
        {q && (
          <p className="mt-2 text-xs text-slate-500" aria-live="polite">
            {total === 0 ? "No results" : `${total} result${total === 1 ? "" : "s"}`} for “{q}”
          </p>
        )}
      </form>

      {!q ? (
        <Card>
          <EmptyState
            icon={Search}
            title="What are you looking for?"
            description="Search help articles by keyword, or find one of your requests by its subject or number."
          />
        </Card>
      ) : total === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title={`Nothing found for “${q}”`}
            description="Try fewer or different words. If you still need help, tell us about it and we'll take a look."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/requests/new" className={buttonClass("primary", "sm")}>
                  Report an issue
                </Link>
                <Link href="/kb" className={buttonClass("outline", "sm")}>
                  Browse help articles
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {exact && (
            <Link
              href={hrefFor(exact)}
              className="group flex items-center gap-4 rounded-xl border border-primary-200 bg-primary-50/60 p-4 transition hover:border-primary-400 hover:bg-primary-50"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white">
                <Ticket className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-primary-700">Go to {ticketRef(exact.number)}</span>
                <span className="mt-0.5 block truncate text-sm text-slate-800">{exact.subject}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <TicketStatusBadge status={exact.status} audience={hrefFor(exact).startsWith("/desk") ? "agent" : "requester"} />
                  <TeamChip team={exact.team} />
                </span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-primary-400 transition group-hover:translate-x-0.5 group-hover:text-primary-600" aria-hidden />
            </Link>
          )}

          {articles.length > 0 && (
            <Card>
              <CardHeader title="Help articles" description={`${articles.length} match${articles.length === 1 ? "" : "es"}`} />
              <ul className="divide-y divide-slate-100">
                {articles.map((a) => (
                  <li key={a.id}>
                    <Link href={`/kb/${a.slug}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50">
                      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-900">{a.title}</span>
                        {a.summary && <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{a.summary}</span>}
                      </span>
                      <TeamChip team={teamNames.get(a.team_id)} className="hidden sm:inline-flex" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {mine.length > 0 && (
            <HitList title="Your requests" icon={ClipboardList} hits={mine} hrefFor={hrefFor} now={now} audience="requester" />
          )}

          {team.length > 0 && <HitList title="Your teams' tickets" icon={Ticket} hits={team} hrefFor={hrefFor} now={now} audience="agent" showRequester />}

          {safe.length < 2 && !number && (
            <p className="text-center text-xs text-slate-500">Type at least 2 letters to search request subjects.</p>
          )}
        </div>
      )}
    </div>
  );
}

function HitList({
  title,
  icon: Icon,
  hits,
  hrefFor,
  now,
  audience,
  showRequester,
}: {
  title: string;
  icon: typeof Ticket;
  hits: Hit[];
  hrefFor: (t: Hit) => string;
  now: number;
  audience: "agent" | "requester";
  showRequester?: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Icon className="h-4 w-4 text-slate-400" aria-hidden /> {title}
          </span>
        }
        description={hits.length === 20 ? "Showing the 20 most recent matches" : `${hits.length} match${hits.length === 1 ? "" : "es"}`}
      />
      <ul className="divide-y divide-slate-100">
        {hits.map((t) => (
          <li key={t.id}>
            <Link href={hrefFor(t)} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{t.subject}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span className="font-mono">{ticketRef(t.number)}</span>
                  <TeamChip team={t.team} />
                  {showRequester && t.requester?.full_name && <span>{t.requester.full_name}</span>}
                  <span title={formatDateTime(t.updated_at)}>Updated {timeAgo(t.updated_at, now)}</span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <TicketStatusBadge status={t.status} audience={audience} />
                <ApprovalBadge status={t.approval_status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
