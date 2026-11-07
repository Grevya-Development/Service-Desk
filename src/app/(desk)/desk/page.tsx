import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Plus, UserRound } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Avatar, Card, EmptyState, PageHeader, StatCard, Table, TBody, TD, TH, THead, TR, buttonClass } from "@/components/ui";
import { LinkTabs } from "@/components/ui/link-tabs";
import { ActionButton } from "@/components/ui/action-button";
import { PriorityDot, SlaBadge, TicketStatusBadge, ApprovalBadge } from "@/components/tickets/badges";
import { ticketRef } from "@/lib/constants";
import { primarySla } from "@/lib/sla";
import { cn, formatDateTime } from "@/lib/utils";
import { assignToMe } from "./actions";
import { QueueFilters } from "./_components/queue-filters";
import { TeamChip } from "./_components/team-chip";
import { applyScope, applyView } from "./_lib/filters";
import { DEFAULT_VIEW, MAX_ROWS, PAGE_SIZE, VIEWS, parseQueueParams, queueClock, queueHref, rawHref, relativeTime, sortTickets, type LightTicket } from "./_lib/queue";

export const metadata = { title: "Ticket queue" };

type QueueRow = LightTicket & {
  subject: string;
  team_id: string;
  assignee_id: string | null;
  requester: { full_name: string | null; department: string | null } | null;
  assignee: { id: string; full_name: string | null; avatar_url: string | null } | null;
};

const ROW_SELECT = `id, number, subject, status, priority, approval_status, team_id, assignee_id, created_at, updated_at, approved_at,
  first_response_due, resolution_due, first_responded_at, resolved_at, response_breached, resolution_breached, pending_since,
  requester:people!requester_id(full_name, department),
  assignee:people!assignee_id(id, full_name, avatar_url)`;

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAgent();
  const sp = await searchParams;
  if (!Object.keys(sp).length) redirect(`/desk?view=${DEFAULT_VIEW}`);
  const supabase = await createClient();
  const teamIds = me.agentTeamIds;

  // Opportunistic SLA sweep (rate-limited in the database); failures don't block the queue.
  await supabase.rpc("maybe_run_sla_checks").then(
    () => undefined,
    () => undefined,
  );

  const [{ data: teams }, { data: categories }, { data: members }] = await Promise.all([
    supabase.from("teams").select("id, name, color").in("id", teamIds).order("sort_order"),
    supabase.from("categories").select("id, name, team_id").in("team_id", teamIds).order("sort_order").order("name"),
    supabase.from("team_members").select("team_id, person:people!employee_id(id, full_name, status)").in("team_id", teamIds),
  ]);

  const agents = new Map<string, { id: string; name: string; teamIds: string[] }>();
  for (const m of members ?? []) {
    const p = m.person as unknown as { id: string; full_name: string | null; status: string } | null;
    if (!p || p.status === "exited") continue;
    const cur = agents.get(p.id);
    if (cur) cur.teamIds.push(m.team_id);
    else agents.set(p.id, { id: p.id, name: p.full_name ?? "Unnamed", teamIds: [m.team_id] });
  }

  const params = parseQueueParams(sp, {
    teamIds: (teams ?? []).map((t) => t.id),
    categoryIds: (categories ?? []).filter((c) => c.team_id === sp.team).map((c) => c.id),
    agentIds: [...agents.keys()],
  });
  const canonical = queueHref(params);
  if (canonical !== rawHref(sp)) redirect(canonical);

  const clock = queueClock();
  const scopeTeams = params.team ? [params.team] : teamIds;
  const count = (view: (typeof VIEWS)[number]["key"]) =>
    applyView(applyScope(supabase.from("tickets").select("id", { count: "exact", head: true }), params, teamIds), view, me.id, clock);

  const [counts, resolvedToday, list] = await Promise.all([
    Promise.all(VIEWS.map((v) => count(v.key))),
    applyScope(supabase.from("tickets").select("id", { count: "exact", head: true }), params, teamIds).gte("resolved_at", clock.todayStart),
    applyView(applyScope(supabase.from("tickets").select(ROW_SELECT), params, teamIds), params.view, me.id, clock)
      .order("updated_at", { ascending: false })
      .limit(MAX_ROWS),
  ]);

  const countOf = Object.fromEntries(VIEWS.map((v, i) => [v.key, counts[i].count ?? 0])) as Record<(typeof VIEWS)[number]["key"], number>;
  const rows = sortTickets((list.data ?? []) as unknown as QueueRow[], params.sort, clock.now);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(params.page, pages);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));
  const myTeamIds = new Set(me.memberships.map((m) => m.teamId));
  const viewLabel = VIEWS.find((v) => v.key === params.view)?.label ?? "Tickets";

  const agentOptions = [...agents.values()]
    .filter((a) => !params.team || a.teamIds.includes(params.team))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ id: a.id, name: a.id === me.id ? `${a.name} (me)` : a.name }));
  const categoryOptions = (categories ?? []).filter((c) => c.team_id === params.team).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div>
      <PageHeader
        title="Ticket queue"
        description={teams && teams.length ? `Tickets for ${teams.map((t) => t.name).join(" & ")}` : "Tickets for your teams"}
        actions={
          <Link href="/desk/new" className={buttonClass("primary")}>
            <Plus className="h-4 w-4" /> New ticket
          </Link>
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

      {teams && teams.length > 1 && (
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
        {pageRows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={params.q || params.priority || params.category || params.assignee ? "No tickets match these filters" : `Nothing in “${viewLabel}”`}
            description={params.view === "unassigned" ? "Every ticket has an owner. Nice work." : "Try another view or clear the filters."}
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Ref</TH>
                <TH className="min-w-[16rem]">Subject</TH>
                <TH>Team</TH>
                <TH>Priority</TH>
                <TH>Status</TH>
                <TH>Assignee</TH>
                <TH>SLA</TH>
                <TH>Updated</TH>
              </TR>
            </THead>
            <TBody>
              {pageRows.map((t) => {
                const team = teamById.get(t.team_id);
                const href = `/desk/tickets/${t.number}`;
                return (
                  <TR key={t.id}>
                    <TD className="whitespace-nowrap py-2.5">
                      <Link href={href} className="font-mono text-xs font-semibold text-primary-600 hover:underline">
                        {ticketRef(t.number)}
                      </Link>
                    </TD>
                    <TD className="py-2.5">
                      <Link href={href} className="line-clamp-1 font-medium text-slate-800 hover:text-primary-600">
                        {t.subject}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {t.requester?.full_name ?? "Former employee"}
                        {t.requester?.department && <span className="text-slate-400"> · {t.requester.department}</span>}
                      </p>
                    </TD>
                    <TD className="whitespace-nowrap py-2.5">{team ? <TeamChip name={team.name} color={team.color} /> : "—"}</TD>
                    <TD className="whitespace-nowrap py-2.5">
                      <PriorityDot priority={t.priority} />
                    </TD>
                    <TD className="whitespace-nowrap py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <TicketStatusBadge status={t.status} audience="agent" />
                        {t.approval_status === "pending" && <ApprovalBadge status="pending" />}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap py-2.5">
                      {t.assignee ? (
                        <span className="inline-flex items-center gap-2 text-xs text-slate-700">
                          <Avatar name={t.assignee.full_name} src={t.assignee.avatar_url} size="xs" />
                          {t.assignee.id === me.id ? "Me" : t.assignee.full_name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-slate-400">Unassigned</span>
                          {myTeamIds.has(t.team_id) && (
                            <ActionButton action={assignToMe} fields={{ ticket_id: t.id }} variant="secondary" size="sm" className="h-6 px-2 text-[11px]">
                              Take it
                            </ActionButton>
                          )}
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap py-2.5">
                      <SlaBadge state={primarySla(t, clock.now)} />
                    </TD>
                    <TD className="whitespace-nowrap py-2.5 text-xs text-slate-500" title={formatDateTime(t.updated_at)}>
                      {relativeTime(t.updated_at, clock.now)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
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
      <span aria-disabled="true" className={buttonClass("outline", "icon", "pointer-events-none h-8 w-8 opacity-40")}>
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
