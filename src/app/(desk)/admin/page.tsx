import Link from "next/link";
import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  Clock,
  Cog,
  FolderTree,
  HardDrive,
  Inbox,
  LayoutGrid,
  Siren,
  Smile,
  Timer,
  TrendingUp,
  UserX,
  Users,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSET_STATUSES, PRIORITIES, PRIORITY_META, ticketRef } from "@/lib/constants";
import { cn, formatDate, orgToday } from "@/lib/utils";
import { Avatar, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR, buttonClass } from "@/components/ui";
import { PriorityBadge, TicketStatusBadge } from "@/components/tickets/badges";
import { RANGE_PRESETS, agentWorkload, backlogAgeBuckets, buildKpis, countBy, countInOrder, dailySeries } from "@/lib/reports/aggregate";
import { TeamChip } from "../requests/_components/team-chip";
import { timeAgo } from "../requests/_lib/query";
import { ROW_CAP, loadPeopleNames, loadReportLookups, parseRange } from "../desk/reports/_lib/load";
import { pctText, shortDay } from "../desk/reports/_lib/format";
import { ChartCard } from "../desk/reports/_components/chart-card";
import { Columns, HorizontalBars, VolumeChart } from "../desk/reports/_components/charts";
import { SlaMeter } from "../desk/reports/_components/sla-meter";
import { BreakdownList, type BreakdownRow } from "./_components/breakdown-list";
import { isOverdue, loadOverviewTickets, loadWeekCounts, weekChange } from "./_lib/overview";

export const metadata: Metadata = { title: "Admin console" };

type Params = Record<string, string | string[] | undefined>;

/** A KPI tile that opens the page behind the number. */
function Tile({
  href,
  label,
  value,
  hint,
  icon: Icon,
  tone,
  alert = false,
}: {
  href: string;
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-xl border bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition hover:border-primary-300 hover:shadow-md",
        alert ? "border-red-200" : "border-slate-200/80",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className={cn("mt-1 text-2xl font-semibold tabular-nums", alert ? "text-red-600" : "text-slate-900")}>{value}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{hint}</p>
        </div>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

const SEVERITY_TONE: Record<string, string> = { major: "bg-red-50 text-red-700", minor: "bg-amber-50 text-amber-700" };

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireAdmin();
  const params = await searchParams;
  const today = orgToday();
  const range = parseRange(params, today);
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };

  const { data: teamRows } = await supabase.from("teams").select("id, key, name, color, active").order("sort_order");
  const teams = teamRows ?? [];
  const teamIds = teams.map((t) => t.id);

  const [data, week, lookups, approvals, myApprovals, incidentsRes, oldestRes, assetCounts, config] = await Promise.all([
    loadOverviewTickets(supabase, teamIds, range),
    loadWeekCounts(supabase, teamIds, today),
    loadReportLookups(supabase, teamIds),
    supabase.from("approvals").select("id", head).eq("status", "pending"),
    // The ones the admin can decide on /approvals: team-lead approvals (admins lead every team) and their own.
    supabase.from("approvals").select("id", head).eq("status", "pending").or(`approver_id.eq.${me.id},team_id.not.is.null`),
    supabase
      .from("incidents")
      .select("id, title, status, severity, started_at, team:teams(name, color)", { count: "exact" })
      .neq("status", "resolved")
      .order("started_at", { ascending: false })
      .limit(5),
    supabase
      .from("tickets")
      .select("number, subject, status, priority, approval_status, created_at, assignee_id, team:teams(name, color)")
      .in("team_id", teamIds.length ? teamIds : ["00000000-0000-0000-0000-000000000000"])
      .in("status", ["new", "open", "pending"])
      .order("created_at", { ascending: true })
      .limit(8),
    Promise.all(Object.keys(ASSET_STATUSES).map((s) => supabase.from("assets").select("id", head).eq("status", s).then((r) => [s, r.count ?? 0] as const))),
    Promise.all([
      supabase.from("teams").select("id", head).eq("active", true),
      supabase.from("team_members").select("employee_id"),
      supabase.from("categories").select("id", head),
      supabase.from("catalog_items").select("id", head).eq("active", true),
      supabase.from("kb_articles").select("id", head).eq("status", "published"),
      supabase.from("kb_articles").select("id", head).eq("status", "draft"),
    ]),
  ]);

  const now = new Date().getTime();
  const { kpis, created, resolved } = buildKpis({ tickets: data.tickets, open: data.open, from: range.from, to: range.to, now });
  const series = dailySeries(data.tickets, range.from, range.to);
  const open = data.open;
  const unassigned = open.filter((t) => !t.assignee_id && (t.status === "new" || t.status === "open") && t.approval_status !== "pending").length;
  const overdue = open.filter((t) => isOverdue(t, now)).length;

  // Open tickets by team (every active team listed, even at zero).
  const openByTeam = new Map<string, number>();
  for (const t of open) openByTeam.set(t.team_id, (openByTeam.get(t.team_id) ?? 0) + 1);
  const teamRowsOpen: BreakdownRow[] = teams
    .filter((t) => t.active || openByTeam.has(t.id))
    .map((t) => ({ key: t.id, label: t.name, count: openByTeam.get(t.id) ?? 0, color: t.color, href: `/desk?view=open&team=${t.id}`, hint: t.active ? undefined : "inactive" }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // Open tickets by where they are in the workflow.
  const awaitingApproval = open.filter((t) => t.approval_status === "pending").length;
  const statusRows: BreakdownRow[] = [
    { key: "approval", label: "Awaiting approval", count: awaitingApproval, color: "#a78bfa", href: "/desk?view=approval" },
    { key: "unassigned", label: "New, not assigned", count: unassigned, color: "#f59e0b", href: "/desk?view=unassigned" },
    {
      key: "progress",
      label: "Being worked on",
      count: open.filter((t) => (t.status === "new" || t.status === "open") && t.assignee_id && t.approval_status !== "pending").length,
      color: "#2a78d6",
      href: "/desk?view=open",
    },
    { key: "pending", label: "Waiting on requester", count: open.filter((t) => t.status === "pending").length, color: "#94a3b8", href: "/desk?view=pending" },
  ];

  const priorityOrder = [...PRIORITIES].map((p) => ({ key: p, label: PRIORITY_META[p].label }));
  const openByPriority = countInOrder(open, (t) => t.priority, priorityOrder);
  const ages = backlogAgeBuckets(open, now);
  const categoryLabel = (id: string) => lookups.categories.get(id) ?? "Removed category";
  const byCategory = countBy(created, (t) => t.category_id, categoryLabel, "No category");

  const workload = agentWorkload(resolved, open, lookups.agents.map((a) => a.id)).slice(0, 10);
  const agentInfo = new Map(lookups.agents.map((a) => [a.id, { name: a.name, avatarUrl: a.avatarUrl }]));
  const oldest = oldestRes.data ?? [];
  const extraNames = await loadPeopleNames(
    supabase,
    [...new Set([...workload.map((w) => w.agentId), ...oldest.map((t) => t.assignee_id).filter((id): id is string => !!id)])].filter((id) => !agentInfo.has(id)),
  );
  const personName = (id: string | null) => (id ? (agentInfo.get(id)?.name ?? extraNames.get(id)?.name ?? "Former agent") : null);

  const assetRows: BreakdownRow[] = assetCounts.map(([status, count]) => ({
    key: status,
    label: ASSET_STATUSES[status].label,
    count,
    href: `/desk/assets?status=${status}`,
    color: { in_stock: "#14b8a6", assigned: "#2a78d6", in_repair: "#f97316", retired: "#94a3b8", lost: "#ef4444" }[status],
  }));
  const assetTotal = assetRows.reduce((n, r) => n + r.count, 0);

  const [activeTeams, members, categories, catalogItems, kbPublished, kbDrafts] = config;
  const agentCount = new Set((members.data ?? []).map((m) => m.employee_id)).size;
  const incidents = incidentsRes.data ?? [];
  const activeIncidents = incidentsRes.count ?? incidents.length;

  const rangeLabel = `${formatDate(range.from)} to ${formatDate(range.to)}`;
  const qs = (extra: Record<string, string>) => `/admin?${new URLSearchParams(extra).toString()}`;
  const reportRange = range.preset ? `range=${range.preset}` : `from=${range.from}&to=${range.to}`;

  return (
    <>
      <PageHeader
        title="Admin console"
        description={`Every team's tickets, SLAs, incidents and assets at a glance · ${rangeLabel}`}
        breadcrumbs={[{ label: "Admin console" }, { label: "Overview" }]}
        actions={
          <Link href={`/desk/reports?${reportRange}`} className={buttonClass("outline")}>
            <BarChart3 className="h-4 w-4" aria-hidden /> Full reports
          </Link>
        }
      />

      <nav aria-label="Date range" className="mb-5 flex flex-wrap gap-2">
        {RANGE_PRESETS.map((p) => {
          const active = range.preset === p.key;
          return (
            <Link
              key={p.key}
              href={qs({ range: p.key })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                active ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>

      {data.error && (
        <p role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Some ticket data couldn&apos;t be loaded, so numbers may be incomplete. ({data.error})
        </p>
      )}
      {data.capped && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> More than {ROW_CAP.toLocaleString("en-IN")} tickets in this period, so only the latest are counted. Pick a shorter range for exact numbers.
        </p>
      )}

      <section aria-label="Key numbers" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile href="/desk?view=open" label="Open tickets" value={open.length.toLocaleString("en-IN")} hint={`Across ${teams.filter((t) => t.active).length} teams`} icon={Inbox} tone="bg-primary-50 text-primary-600" />
        <Tile href="/desk?view=unassigned" label="Not assigned" value={unassigned.toLocaleString("en-IN")} hint={unassigned ? "Waiting for an agent" : "Everything has an owner"} icon={UserX} tone="bg-amber-50 text-amber-600" alert={unassigned > 0 && unassigned >= Math.max(5, open.length / 2)} />
        <Tile href="/desk?view=breaching" label="Past SLA target" value={overdue.toLocaleString("en-IN")} hint={overdue ? "Open and overdue now" : "Nothing overdue"} icon={AlertTriangle} tone="bg-red-50 text-red-600" alert={overdue > 0} />
        <Tile
          href={myApprovals.count ? "/approvals" : "/desk?view=approval"}
          label="Awaiting approval"
          value={(approvals.count ?? 0).toLocaleString("en-IN")}
          hint={myApprovals.count ? `${myApprovals.count} for you to decide` : approvals.count ? "Waiting on managers" : "Nothing to approve"}
          icon={CheckSquare}
          tone="bg-violet-50 text-violet-600"
        />
        <Tile href="/desk/reports?range=7d" label="Created this week" value={week.createdThisWeek.toLocaleString("en-IN")} hint={weekChange(week.createdThisWeek, week.createdLastWeek)} icon={TrendingUp} tone="bg-sky-50 text-sky-600" />
        <Tile href="/desk?view=resolved" label="Resolved this week" value={week.resolvedThisWeek.toLocaleString("en-IN")} hint="Last 7 days" icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600" />
        <Tile href="/desk/incidents" label="Active incidents" value={activeIncidents.toLocaleString("en-IN")} hint={activeIncidents ? "Outages in progress" : "All services normal"} icon={Siren} tone="bg-rose-50 text-rose-600" alert={activeIncidents > 0} />
        <Tile href={`/desk/reports?${reportRange}`} label="Happy requesters" value={pctText(kpis.csat.pct)} hint={kpis.csat.rated ? `${kpis.csat.good} of ${kpis.csat.rated} ratings` : "No ratings in this period"} icon={Smile} tone="bg-amber-50 text-amber-600" />
      </section>

      <div className="space-y-6">
        <ChartCard
          title="Tickets created and resolved"
          description={`All teams, per day (${rangeLabel}). When resolved stays below created, the backlog is growing.`}
          table={{ columns: ["Day", "Created", "Resolved"], rows: series.map((d) => [shortDay(d.day), d.created, d.resolved]) }}
        >
          <VolumeChart data={series} />
        </ChartCard>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Open tickets by team" description="Right now. Open a team to see its queue." />
            <CardBody>
              {teamRowsOpen.length ? (
                <BreakdownList rows={teamRowsOpen} />
              ) : (
                <EmptyState icon={Users} title="No teams yet" description="Create a team to start taking tickets." className="py-6" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Where open tickets are" description="Right now, by stage." />
            <CardBody>
              {open.length ? (
                <BreakdownList rows={statusRows} total={open.length} />
              ) : (
                <EmptyState icon={CheckCircle2} title="Nothing open right now" description="Every ticket is resolved or closed." className="py-6" />
              )}
            </CardBody>
          </Card>

          <ChartCard
            title="Open tickets by priority"
            description="Right now, least to most urgent."
            table={{ columns: ["Priority", "Open tickets"], rows: openByPriority.map((s) => [s.label, s.count]) }}
          >
            {open.length ? (
              <Columns data={openByPriority} ordinal ariaLabel={`Column chart of open tickets by priority: ${openByPriority.map((s) => `${s.label} ${s.count}`).join(", ")}`} />
            ) : (
              <EmptyState icon={CheckCircle2} title="Nothing open right now" className="py-8" />
            )}
          </ChartCard>

          <ChartCard
            title="Open tickets by age"
            description="How long today's open tickets have been waiting since they were raised."
            table={{ columns: ["Age", "Open tickets"], rows: ages.map((s) => [s.label, s.count]) }}
          >
            {open.length ? (
              <Columns data={ages} ordinal ariaLabel={`Column chart of open tickets by age: ${ages.map((s) => `${s.label} ${s.count}`).join(", ")}`} />
            ) : (
              <EmptyState icon={CheckCircle2} title="Nothing open right now" className="py-8" />
            )}
          </ChartCard>

          <Card>
            <CardHeader title="SLA performance" description={`All teams, ${rangeLabel}.`} />
            <CardBody className="space-y-5">
              <SlaMeter label="First reply on time" rate={kpis.responseSla} hint="tickets with a reply or an overdue reply" />
              <SlaMeter label="Resolved on time" rate={kpis.resolutionSla} hint="resolved tickets with a target" />
              <p className="text-xs text-slate-500">
                Targets count working hours only.{" "}
                <Link href="/admin/sla" className="font-medium text-primary-600 hover:underline">
                  Change SLA targets
                </Link>
              </p>
            </CardBody>
          </Card>

          <ChartCard
            title="Top categories"
            description={`What people raised tickets about, ${rangeLabel}.`}
            table={{ columns: ["Category", "Tickets"], rows: byCategory.map((s) => [s.label, s.count]) }}
          >
            {byCategory.length ? (
              <HorizontalBars data={byCategory.slice(0, 8)} ariaLabel={`Bar chart of tickets by category: ${byCategory.map((s) => `${s.label} ${s.count}`).join(", ")}`} />
            ) : (
              <EmptyState icon={FolderTree} title="No new tickets in this period" className="py-8" />
            )}
            {byCategory.length > 8 && <p className="mt-2 text-xs text-slate-500">Showing the 8 biggest. The table has them all.</p>}
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title="Oldest open tickets"
              description="Waiting the longest. Start here."
              action={
                <Link href="/desk?view=open&sort=oldest" className="text-xs font-medium text-primary-600 hover:underline">
                  All open
                </Link>
              }
            />
            {oldest.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Nothing open right now" description="The queues are empty." className="py-8" />
            ) : (
              <Table>
                <caption className="sr-only">Oldest open tickets</caption>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH scope="col">Ticket</TH>
                    <TH scope="col" className="hidden 2xl:table-cell">
                      Team
                    </TH>
                    <TH scope="col">Status</TH>
                    <TH scope="col" className="hidden sm:table-cell">
                      Assignee
                    </TH>
                    <TH scope="col" className="text-right">
                      Raised
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {oldest.map((t) => {
                    const team = t.team as unknown as { name: string; color: string } | null;
                    return (
                      <TR key={t.number}>
                        <TD className="w-full max-w-0 min-w-40">
                          <Link href={`/desk/tickets/${t.number}`} className="block truncate font-medium text-slate-800 hover:text-primary-700" title={t.subject}>
                            <span className="mr-1.5 text-xs text-slate-400">{ticketRef(t.number)}</span>
                            {t.subject}
                          </Link>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <PriorityBadge priority={t.priority} />
                            <TeamChip team={team} className="2xl:hidden" />
                          </span>
                        </TD>
                        <TD className="hidden 2xl:table-cell">
                          <TeamChip team={team} />
                        </TD>
                        <TD>
                          <TicketStatusBadge status={t.approval_status === "pending" ? "new" : t.status} />
                        </TD>
                        <TD className="hidden whitespace-nowrap text-slate-600 sm:table-cell">{personName(t.assignee_id) ?? <span className="italic text-slate-400">Not assigned</span>}</TD>
                        <TD className="whitespace-nowrap text-right text-xs text-slate-500">{timeAgo(t.created_at, now)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Active incidents"
              description="Outages affecting many people."
              action={
                <Link href="/desk/incidents" className="text-xs font-medium text-primary-600 hover:underline">
                  All incidents
                </Link>
              }
            />
            <CardBody>
              {incidents.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="All services normal" description="No incidents in progress." className="py-6" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {incidents.map((i) => {
                    const team = i.team as unknown as { name: string; color: string } | null;
                    return (
                      <li key={i.id} className="py-2.5 first:pt-0 last:pb-0">
                        <Link href={`/desk/incidents/${i.id}`} className="block text-sm font-medium text-slate-800 hover:text-primary-700">
                          {i.title}
                        </Link>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span className={cn("rounded-full px-2 py-0.5 font-medium capitalize", SEVERITY_TONE[i.severity] ?? "bg-slate-100 text-slate-600")}>{i.severity}</span>
                          <span className="capitalize">{i.status}</span>
                          <span aria-hidden>·</span>
                          <span>started {timeAgo(i.started_at, now)}</span>
                          {team && <TeamChip team={team} />}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title="Agent workload"
              description={`Open tickets each agent holds now, and what they resolved (${rangeLabel}).`}
              action={
                <Link href="/admin/teams" className="text-xs font-medium text-primary-600 hover:underline">
                  Manage agents
                </Link>
              }
            />
            {workload.length === 0 ? (
              <EmptyState icon={Users} title="No agents yet" description="Add people to a team so tickets can be assigned." className="py-8" />
            ) : (
              <Table>
                <caption className="sr-only">Agent workload</caption>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH scope="col">Agent</TH>
                    <TH scope="col" className="text-right">
                      Open now
                    </TH>
                    <TH scope="col" className="text-right">
                      Resolved
                    </TH>
                    <TH scope="col" className="hidden text-right sm:table-cell">
                      On time
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {workload.map((w) => {
                    const info = agentInfo.get(w.agentId) ?? extraNames.get(w.agentId) ?? { name: "Former agent", avatarUrl: null };
                    return (
                      <TR key={w.agentId}>
                        <TD className="min-w-40">
                          <Link href={`/desk?view=open&assignee=${w.agentId}`} className="flex items-center gap-2 hover:text-primary-700">
                            <Avatar name={info.name} src={info.avatarUrl} size="xs" />
                            <span className="truncate text-slate-800">{info.name}</span>
                          </Link>
                        </TD>
                        <TD className="text-right tabular-nums">{w.openAssigned}</TD>
                        <TD className="text-right tabular-nums">{w.resolvedInRange}</TD>
                        <TD className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
                          {pctText(w.sla.pct)}
                          {w.sla.total > 0 && <span className="ml-1 text-xs text-slate-400">({w.sla.met}/{w.sla.total})</span>}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Assets"
              description={assetTotal ? `${assetTotal.toLocaleString("en-IN")} in the register.` : "The IT asset register."}
              action={
                <Link href="/desk/assets" className="text-xs font-medium text-primary-600 hover:underline">
                  Open register
                </Link>
              }
            />
            <CardBody>
              {assetTotal ? (
                <BreakdownList rows={assetRows} unit="assets" />
              ) : (
                <EmptyState
                  icon={HardDrive}
                  title="No assets yet"
                  description="Add laptops, phones and licences to track who has what."
                  action={
                    <Link href="/desk/assets/new" className={buttonClass("outline", "sm")}>
                      Add an asset
                    </Link>
                  }
                  className="py-6"
                />
              )}
            </CardBody>
          </Card>
        </div>

        <section aria-labelledby="config-heading">
          <h2 id="config-heading" className="mb-3 text-sm font-semibold text-slate-700">
            Configuration
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <ConfigLink href="/admin/teams" icon={Users} label="Teams & agents" value={`${activeTeams.count ?? 0} teams · ${agentCount} agents`} />
            <ConfigLink href="/admin/categories" icon={FolderTree} label="Categories" value={`${categories.count ?? 0} ${categories.count === 1 ? "category" : "categories"}`} />
            <ConfigLink href="/admin/sla" icon={Timer} label="SLA targets" value="Reply and resolve times" />
            <ConfigLink href="/admin/catalog" icon={LayoutGrid} label="Service catalog" value={`${catalogItems.count ?? 0} active items`} />
            <ConfigLink href="/desk/kb" icon={BookOpenCheck} label="Knowledge base" value={`${kbPublished.count ?? 0} published${kbDrafts.count ? ` · ${kbDrafts.count} ${kbDrafts.count === 1 ? "draft" : "drafts"}` : ""}`} />
            <ConfigLink href="/admin/settings" icon={Cog} label="Settings" value="Business hours, email, auto-close" />
            <ConfigLink href="/desk/templates" icon={Clock} label="Reply templates" value="Saved replies for agents" />
          </div>
        </section>
      </div>
    </>
  );
}

function ConfigLink({ href, icon: Icon, label, value }: { href: string; icon: LucideIcon; label: string; value: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 transition hover:border-primary-300 hover:shadow-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-primary-50 group-hover:text-primary-600">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block truncate text-xs text-slate-500">{value}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-primary-500" aria-hidden />
    </Link>
  );
}
