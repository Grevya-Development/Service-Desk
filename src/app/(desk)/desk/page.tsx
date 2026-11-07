import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, CheckCircle2, ChevronLeft, ChevronRight, Download, Inbox, Plus, UserRound } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader, StatCard, buttonClass } from "@/components/ui";
import { LinkTabs } from "@/components/ui/link-tabs";
import { ticketRef } from "@/lib/constants";
import { primarySla } from "@/lib/sla";
import { cn, formatDateTime, humanize } from "@/lib/utils";
import { QueueFilters } from "./_components/queue-filters";
import { QueueTable, type QueueRowView } from "./_components/queue-table";
import { QUEUE_SHORTCUTS, ShortcutsHelp } from "./_components/shortcuts";
import { fetchQueueRows, loadQueueContext } from "./_lib/context";
import { applyScope, applyView } from "./_lib/filters";
import { DEFAULT_VIEW, MAX_ROWS, PAGE_SIZE, VIEWS, cleanSearch, queueClock, queueHref, rawHref, relativeTime } from "./_lib/queue";

export const metadata = { title: "Ticket queue" };

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAgent();
  const sp = await searchParams;
  if (!Object.keys(sp).length) redirect(`/desk?view=${DEFAULT_VIEW}`);
  const supabase = await createClient();

  // Opportunistic SLA sweep (rate-limited in the database); failures don't block the queue.
  await supabase.rpc("maybe_run_sla_checks").then(
    () => undefined,
    () => undefined,
  );

  const { teamIds, teams, categories, agents, params } = await loadQueueContext(supabase, me, sp);
  const canonical = queueHref(params);
  if (canonical !== rawHref(sp)) redirect(canonical);
  const clock = queueClock();
  const count = (view: (typeof VIEWS)[number]["key"]) =>
    applyView(applyScope(supabase.from("tickets").select("id", { count: "exact", head: true }), params, teamIds), view, me.id, clock);

  const scopeTeams = params.team ? [params.team] : teamIds;
  const [counts, resolvedToday, list, incidentsRes] = await Promise.all([
    Promise.all(VIEWS.map((v) => count(v.key))),
    applyScope(supabase.from("tickets").select("id", { count: "exact", head: true }), params, teamIds).gte("resolved_at", clock.todayStart),
    fetchQueueRows(supabase, params, teamIds, me.id, { limit: MAX_ROWS }),
    supabase.from("incidents").select("id, title, team_id, status").in("team_id", scopeTeams).neq("status", "resolved").order("started_at", { ascending: false }),
  ]);

  const rows = list.rows;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (params.page > pages) redirect(queueHref(params, { page: pages }));

  const countOf = Object.fromEntries(VIEWS.map((v, i) => [v.key, counts[i].count ?? 0])) as Record<(typeof VIEWS)[number]["key"], number>;
  const page = params.page;
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const myTeamIds = new Set(me.memberships.map((m) => m.teamId));
  const viewLabel = VIEWS.find((v) => v.key === params.view)?.label ?? "Tickets";
  const showTeam = teams.length > 1 && !params.team;

  const agentOptions = [...agents.values()]
    .filter((a) => !params.team || a.teamIds.includes(params.team))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ id: a.id, name: a.id === me.id ? `${a.name} (me)` : a.name }));
  const categoryOptions = categories.filter((c) => c.team_id === params.team).map((c) => ({ id: c.id, name: c.name }));
  const incidentOptions = (incidentsRes.data ?? []).map((i) => ({ id: i.id, name: `${i.title} · ${humanize(i.status)}${showTeam ? ` (${teamById.get(i.team_id)?.name ?? "team"})` : ""}` }));

  const views: QueueRowView[] = pageRows.map((t) => {
    const team = teamById.get(t.team_id);
    return {
      id: t.id,
      number: t.number,
      subject: t.subject,
      requester: t.requester?.full_name ?? "Former employee",
      department: t.requester?.department ?? null,
      team: team ? { name: team.name, color: team.color } : null,
      priority: t.priority,
      status: t.status,
      approvalPending: t.approval_status === "pending",
      assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.full_name ?? "Unnamed", avatarUrl: t.assignee.avatar_url } : null,
      canTake: !t.assignee && myTeamIds.has(t.team_id),
      sla: primarySla(t, clock.now),
      updated: relativeTime(t.updated_at, clock.now),
      updatedTitle: formatDateTime(t.updated_at),
    };
  });

  const filtered = Boolean(params.q || params.priority || params.category || params.assignee);
  const searchedNumber = cleanSearch(params.q).number;
  const exportQs = queueHref({ ...params, page: 1 }).split("?")[1];

  return (
    <div className="pb-16">
      <PageHeader
        title="Ticket queue"
        description={teams.length ? `Tickets for ${teams.map((t) => t.name).join(" & ")}` : "Tickets for your teams"}
        actions={
          <>
            <ShortcutsHelp shortcuts={QUEUE_SHORTCUTS} />
            <a href={`/desk/export?${exportQs}`} className={buttonClass("outline")} title="Download this view with its filters as a spreadsheet" download>
              <Download className="h-4 w-4" /> Export CSV
            </a>
            <Link href="/desk/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" /> New ticket
            </Link>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Unassigned" value={countOf.unassigned} icon={Inbox} tone="bg-violet-50 text-violet-600" />
        <StatCard label="Mine open" value={countOf.mine} icon={UserRound} />
        <StatCard
          label="Breaching soon"
          value={countOf.breaching}
          hint="Overdue or due within 2 hours"
          icon={AlarmClock}
          tone={countOf.breaching ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}
        />
        <StatCard label="Resolved today" value={resolvedToday.count ?? 0} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600" />
      </div>

      {teams.length > 1 && (
        <nav aria-label="Team" className="mb-3 flex flex-wrap gap-2">
          <Link
            href={queueHref(params, { team: null, category: null, page: 1 })}
            aria-current={!params.team ? "true" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              !params.team ? "border-primary-600 bg-primary-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
          >
            All my teams
          </Link>
          {teams.map((t) => {
            const active = params.team === t.id;
            return (
              <Link
                key={t.id}
                href={queueHref(params, { team: t.id, category: null, page: 1 })}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active ? "text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                )}
                style={active ? { backgroundColor: t.color, borderColor: t.color } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: active ? "#fff" : t.color }} />
                {t.name}
              </Link>
            );
          })}
        </nav>
      )}

      <QueueFilters key={canonical} params={params} categories={categoryOptions} agents={agentOptions} />

      <LinkTabs tabs={VIEWS.map((v) => ({ label: v.label, href: queueHref(params, { view: v.key, page: 1 }), count: countOf[v.key] }))} className="mb-4" />

      <Card className="overflow-hidden">
        {list.error ? (
          <EmptyState icon={Inbox} title="We couldn't load the tickets" description="Refresh the page. If it keeps happening, tell the desk admin." />
        ) : pageRows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={filtered ? "No tickets match these filters" : `Nothing in “${viewLabel}”`}
            description={
              searchedNumber !== null ? (
                <>
                  {ticketRef(searchedNumber)} isn&apos;t in this view.{" "}
                  <Link href={`/desk/tickets/${searchedNumber}`} className="font-medium text-primary-600 underline">
                    Open {ticketRef(searchedNumber)}
                  </Link>
                </>
              ) : params.view === "unassigned" && !filtered ? (
                "Every ticket has an owner. Nice work."
              ) : (
                "Try another view or clear the filters."
              )
            }
          />
        ) : (
          <QueueTable rows={views} meId={me.id} showTeam={showTeam} agents={agentOptions} incidents={incidentOptions} />
        )}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              {total >= MAX_ROWS && " (narrow the filters to see older tickets)"}
            </span>
            {pages > 1 && (
              <div className="flex items-center gap-1">
                <PageLink href={page > 1 ? queueHref(params, { page: page - 1 }) : null} label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </PageLink>
                <span className="px-2">
                  Page {page} of {pages}
                </span>
                <PageLink href={page < pages ? queueHref(params, { page: page + 1 }) : null} label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </PageLink>
              </div>
            )}
          </div>
        )}
      </Card>
      {scopeTeams.length === 0 && <p className="mt-3 text-xs text-slate-500">You aren&apos;t on any active team yet. Ask a team lead to add you.</p>}
    </div>
  );
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href) {
    return (
      <span aria-disabled="true" aria-label={label} className={buttonClass("outline", "icon", "pointer-events-none h-8 w-8 opacity-40")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={buttonClass("outline", "icon", "h-8 w-8")}>
      {children}
    </Link>
  );
}
