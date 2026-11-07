import Link from "next/link";
import { AlertTriangle, BarChart3, CheckCircle2, Clock, Inbox, MessageSquareReply, Smile, Timer, TrendingUp, Users } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PRIORITIES, PRIORITY_META } from "@/lib/constants";
import { formatDuration } from "@/lib/sla";
import { cn, formatDate, orgToday } from "@/lib/utils";
import { Avatar, Card, CardBody, CardHeader, EmptyState, Input, PageHeader, ProgressBar, Select, StatCard, Table, TBody, TD, TH, THead, TR, buttonClass } from "@/components/ui";
import { RANGE_PRESETS, agentWorkload, backlogAgeBuckets, buildKpis, countBy, countInOrder, dailySeries, type Rate } from "@/lib/reports/aggregate";
import { ROW_CAP, loadPeopleNames, loadReportLookups, loadReportTickets, parseRange } from "./_lib/load";
import { pctText, shortDay } from "./_lib/format";
import { ChartCard } from "./_components/chart-card";
import { Columns, HorizontalBars, VolumeChart } from "./_components/charts";

export const metadata = { title: "Reports" };

const rateHint = (r: Rate, noun: string) => (r.total ? `${r.met} of ${r.total} ${noun}` : "No data for this period");

function SlaMeter({ label, rate, hint }: { label: string; rate: Rate; hint: string }) {
  const p = rate.pct;
  const tone = p === null ? "bg-slate-300" : p >= 90 ? "bg-emerald-500" : p >= 75 ? "bg-amber-500" : "bg-red-500";
  const Icon = p === null ? Clock : p >= 90 ? CheckCircle2 : AlertTriangle;
  const word = p === null ? "No data" : p >= 90 ? "On target" : p >= 75 ? "Needs attention" : "Off target";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-slate-900">{pctText(p)}</p>
      </div>
      <ProgressBar value={p ?? 0} barClassName={tone} className="bg-slate-100" />
      <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {word} · {rate.total ? `${rate.met} of ${rate.total} ${hint}` : "nothing measured yet"}
      </p>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAgent();
  const params = await searchParams;
  const today = orgToday();
  const range = parseRange(params, today);
  const supabase = await createClient();

  const { data: teamRows } = me.agentTeamIds.length
    ? await supabase.from("teams").select("id, name, color").in("id", me.agentTeamIds).order("sort_order")
    : { data: [] as { id: string; name: string; color: string }[] };
  const teams = teamRows ?? [];
  const teamParam = typeof params.team === "string" ? params.team : "";
  const team = teams.find((t) => t.id === teamParam) ?? null;
  const teamIds = team ? [team.id] : teams.map((t) => t.id);

  const qs = (extra: Record<string, string>) => {
    const sp = new URLSearchParams(team ? { team: team.id } : {});
    for (const [k, v] of Object.entries(extra)) sp.set(k, v);
    return `/desk/reports?${sp.toString()}`;
  };

  const header = (
    <PageHeader
      title="Reports"
      description={`${team ? team.name : teams.length > 1 ? "All your teams" : (teams[0]?.name ?? "Your teams")} · ${formatDate(range.from)} to ${formatDate(range.to)}`}
      breadcrumbs={[{ label: "Agent workspace", href: "/desk" }, { label: "Reports" }]}
    />
  );

  if (teams.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={Users} title="You're not on a team yet" description="Reports show the tickets of the teams you work in. Ask a team lead to add you." />
        </Card>
      </>
    );
  }

  const [data, lookups] = await Promise.all([loadReportTickets(supabase, teamIds, range), loadReportLookups(supabase, teamIds)]);
  const now = new Date().getTime();
  const { kpis, created, resolved } = buildKpis({ tickets: data.tickets, open: data.open, from: range.from, to: range.to, now });

  const series = dailySeries(data.tickets, range.from, range.to);
  const byCategory = countBy(created, (t) => t.category_id, (k) => lookups.categories.get(k) ?? "Other team's category", "No category");
  const priorityOrder = [...PRIORITIES].map((p) => ({ key: p, label: PRIORITY_META[p].label })); // low → urgent
  const byPriority = countInOrder(created, (t) => t.priority, priorityOrder);
  const ages = backlogAgeBuckets(data.open, now);
  const workload = agentWorkload(resolved, data.open, lookups.agents.map((a) => a.id));
  const agentInfo = new Map(lookups.agents.map((a) => [a.id, { name: a.name, avatarUrl: a.avatarUrl }]));
  const extraNames = await loadPeopleNames(
    supabase,
    workload.map((w) => w.agentId).filter((id) => !agentInfo.has(id)),
  );
  const unassignedOpen = data.open.filter((t) => !t.assignee_id).length;
  const nothing = kpis.created === 0 && kpis.resolved === 0 && kpis.backlog === 0;

  return (
    <>
      {header}

      {/* Filters: one row above everything they control. */}
      <Card className="mb-6">
        <CardBody className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <nav aria-label="Date range" className="flex flex-wrap gap-2">
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
          <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="r-team" className="mb-1 block text-xs font-medium text-slate-600">
                Team
              </label>
              <Select id="r-team" name="team" defaultValue={team?.id ?? ""}>
                {teams.length > 1 && <option value="">All my teams</option>}
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="r-from" className="mb-1 block text-xs font-medium text-slate-600">
                From
              </label>
              <Input id="r-from" name="from" type="date" defaultValue={range.from} max={today} required />
            </div>
            <div>
              <label htmlFor="r-to" className="mb-1 block text-xs font-medium text-slate-600">
                To
              </label>
              <Input id="r-to" name="to" type="date" defaultValue={range.to} max={today} required />
            </div>
            <button type="submit" className={buttonClass("secondary", "md", "col-span-2 sm:col-span-1")}>
              Apply
            </button>
          </form>
        </CardBody>
      </Card>

      {data.error && (
        <p role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Some ticket data couldn&apos;t be loaded, so numbers may be incomplete. ({data.error})
        </p>
      )}
      {data.capped && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> This period has more than {ROW_CAP.toLocaleString("en-IN")} tickets, so only the latest are counted. Pick a shorter range for exact numbers.
        </p>
      )}

      <section aria-label="Key numbers" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Tickets created" value={kpis.created.toLocaleString("en-IN")} hint="In this period" icon={Inbox} />
        <StatCard label="Tickets resolved" value={kpis.resolved.toLocaleString("en-IN")} hint="In this period" icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600" />
        <StatCard label="Open right now" value={kpis.backlog.toLocaleString("en-IN")} hint={unassignedOpen ? `${unassignedOpen} not assigned` : "All assigned"} icon={TrendingUp} tone="bg-violet-50 text-violet-600" />
        <StatCard label="Happy requesters" value={pctText(kpis.csat.pct)} hint={kpis.csat.rated ? `${kpis.csat.good} of ${kpis.csat.rated} ratings` : "No ratings yet"} icon={Smile} tone="bg-amber-50 text-amber-600" />
        <StatCard label="First reply on time" value={pctText(kpis.responseSla.pct)} hint={rateHint(kpis.responseSla, "tickets")} icon={MessageSquareReply} tone="bg-sky-50 text-sky-600" />
        <StatCard label="Resolved on time" value={pctText(kpis.resolutionSla.pct)} hint={rateHint(kpis.resolutionSla, "tickets")} icon={Timer} tone="bg-teal-50 text-teal-600" />
        <StatCard label="Typical first reply" value={formatDuration(kpis.medianFirstResponseMins)} hint="Median, clock time" icon={Clock} tone="bg-slate-100 text-slate-600" />
        <StatCard label="Typical time to resolve" value={formatDuration(kpis.medianResolutionMins)} hint="Median, clock time" icon={Clock} tone="bg-slate-100 text-slate-600" />
      </section>

      {nothing ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="No tickets in this period"
            description="Nothing was raised or resolved between these dates, and nothing is open. Try a longer range."
            action={
              range.preset !== "90d" ? (
                <Link href={qs({ range: "90d" })} className={buttonClass("outline", "sm")}>
                  Show the last 90 days
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <ChartCard
            title="Tickets created and resolved"
            description="Per day. When resolved stays below created, the queue is growing."
            table={{ columns: ["Day", "Created", "Resolved"], rows: series.map((d) => [shortDay(d.day), d.created, d.resolved]) }}
          >
            <VolumeChart data={series} />
          </ChartCard>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard
              title="By category"
              description="Tickets created in this period."
              table={{ columns: ["Category", "Tickets"], rows: byCategory.map((s) => [s.label, s.count]) }}
            >
              {byCategory.length ? (
                <HorizontalBars data={byCategory.slice(0, 12)} ariaLabel={`Bar chart of tickets by category: ${byCategory.map((s) => `${s.label} ${s.count}`).join(", ")}`} />
              ) : (
                <EmptyState icon={BarChart3} title="No new tickets in this period" className="py-8" />
              )}
              {byCategory.length > 12 && <p className="mt-2 text-xs text-slate-500">Showing the 12 biggest categories. The table has them all.</p>}
            </ChartCard>

            <ChartCard
              title="By priority"
              description="Tickets created in this period, least to most urgent."
              table={{ columns: ["Priority", "Tickets"], rows: byPriority.map((s) => [s.label, s.count]) }}
            >
              {kpis.created ? (
                <Columns data={byPriority} ordinal ariaLabel={`Column chart of tickets by priority: ${byPriority.map((s) => `${s.label} ${s.count}`).join(", ")}`} />
              ) : (
                <EmptyState icon={BarChart3} title="No new tickets in this period" className="py-8" />
              )}
            </ChartCard>

            <ChartCard
              title="Open tickets by age"
              description="How long today's open tickets have been waiting since they were raised."
              table={{ columns: ["Age", "Open tickets"], rows: ages.map((s) => [s.label, s.count]) }}
            >
              {kpis.backlog ? (
                <Columns data={ages} ordinal ariaLabel={`Column chart of open tickets by age: ${ages.map((s) => `${s.label} ${s.count}`).join(", ")}`} />
              ) : (
                <EmptyState icon={CheckCircle2} title="Nothing open right now" description="The queue is empty. Nice work." className="py-8" />
              )}
            </ChartCard>

            <Card>
              <CardHeader title="SLA at a glance" description="How often the team met its response and resolution targets in this period." />
              <CardBody className="space-y-5">
                <SlaMeter label="First reply on time" rate={kpis.responseSla} hint="tickets with a reply or an overdue reply" />
                <SlaMeter label="Resolved on time" rate={kpis.resolutionSla} hint="resolved tickets with a target" />
                <p className="text-xs text-slate-500">Targets count working hours only; time spent waiting on the requester doesn&apos;t count against the team.</p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Agent workload" description="Open tickets each agent holds now, and what they resolved in this period." />
            {workload.length === 0 ? (
              <EmptyState icon={Users} title="No agents on this team yet" className="py-8" />
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
                    <TH scope="col" className="text-right">
                      Happy requesters
                    </TH>
                    <TH scope="col" className="text-right">
                      Resolved on time
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {workload.map((w) => {
                    const info = agentInfo.get(w.agentId) ?? extraNames.get(w.agentId) ?? { name: "Former agent", avatarUrl: null };
                    return (
                      <TR key={w.agentId}>
                        <TD className="min-w-44">
                          <span className="flex items-center gap-2">
                            <Avatar name={info.name} src={info.avatarUrl} size="xs" />
                            <span className="truncate text-slate-800">{info.name}</span>
                          </span>
                        </TD>
                        <TD className="text-right tabular-nums">{w.openAssigned}</TD>
                        <TD className="text-right tabular-nums">{w.resolvedInRange}</TD>
                        <TD className="whitespace-nowrap text-right tabular-nums">
                          {pctText(w.csat.pct)}
                          {w.csat.rated > 0 && <span className="ml-1 text-xs text-slate-400">({w.csat.rated})</span>}
                        </TD>
                        <TD className="whitespace-nowrap text-right tabular-nums">
                          {pctText(w.sla.pct)}
                          {w.sla.total > 0 && <span className="ml-1 text-xs text-slate-400">({w.sla.met}/{w.sla.total})</span>}
                        </TD>
                      </TR>
                    );
                  })}
                  {unassignedOpen > 0 && (
                    <TR className="bg-slate-50/60">
                      <TD className="text-slate-500 italic">Not assigned yet</TD>
                      <TD className="text-right tabular-nums text-slate-700">{unassignedOpen}</TD>
                      <TD className="text-right text-slate-400">—</TD>
                      <TD className="text-right text-slate-400">—</TD>
                      <TD className="text-right text-slate-400">—</TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
