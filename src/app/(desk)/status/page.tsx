import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ChevronDown, History, Settings2, TicketCheck, Users } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { ticketRef } from "@/lib/constants";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { INCIDENT_STATUS_META, daysAgoIso, durationText, SEVERITY_META, isIncidentStatus, minutesBetween, peopleCount, safeColor, severityOf } from "./_lib/incident";
import { IncidentTimeline, SeverityBadge, StatusSteps, TeamChip, type TimelineUpdate } from "./_components/incident-bits";
import { AffectedToggle } from "./_components/affected-toggle";
import { AutoRefresh } from "./_components/auto-refresh";

export const metadata: Metadata = { title: "Service status" };

const INCIDENT_SELECT =
  "id, title, summary, status, severity, started_at, resolved_at, team_id, team:teams(id, name, color), updates:incident_updates(id, status, body, created_at, author:people!author_id(full_name, avatar_url))";

export default async function StatusPage() {
  const me = await requireViewer();
  const supabase = await createClient();
  const since = daysAgoIso(30);

  const [{ data: activeRows, error: activeError }, { data: resolvedRows }, { data: mySubs }] = await Promise.all([
    supabase.from("incidents").select(INCIDENT_SELECT).neq("status", "resolved").order("started_at", { ascending: false }),
    supabase.from("incidents").select(INCIDENT_SELECT).eq("status", "resolved").gte("resolved_at", since).order("resolved_at", { ascending: false }).limit(50),
    supabase.from("incident_subscribers").select("incident_id").eq("employee_id", me.id),
  ]);

  // Major first, then newest.
  const active = [...(activeRows ?? [])].sort((a, b) => (a.severity === b.severity ? b.started_at.localeCompare(a.started_at) : a.severity === "major" ? -1 : 1));
  const resolved = resolvedRows ?? [];
  const activeIds = active.map((i) => i.id);
  const subscribed = new Set((mySubs ?? []).map((s) => s.incident_id));

  const [{ data: subRows }, { data: myTickets }] = await Promise.all([
    me.isAgent && activeIds.length ? supabase.from("incident_subscribers").select("incident_id").in("incident_id", activeIds) : Promise.resolve({ data: [] as { incident_id: string }[] }),
    activeIds.length
      ? supabase.from("tickets").select("number, subject, incident_id").eq("requester_id", me.id).in("incident_id", activeIds).in("status", ["new", "open", "pending"]).order("number")
      : Promise.resolve({ data: [] as { number: number; subject: string; incident_id: string | null }[] }),
  ]);
  const affectedCount = new Map<string, number>();
  for (const s of subRows ?? []) affectedCount.set(s.incident_id, (affectedCount.get(s.incident_id) ?? 0) + 1);

  const hasMajor = active.some((i) => i.severity === "major");

  return (
    <div className="mx-auto max-w-3xl">
      <AutoRefresh seconds={60} />
      <PageHeader title="Service status" description="See if something is down, what we're doing about it, and get told when it's fixed." />

      {activeError ? (
        <Card className="p-5 text-sm text-slate-600" role="alert">
          We couldn&apos;t load the service status right now. Please refresh the page in a moment.
        </Card>
      ) : active.length === 0 ? (
        <Card className="flex items-center gap-4 border-emerald-200 bg-emerald-50/70 p-5" role="status">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <CheckCircle2 className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="text-base font-semibold text-emerald-900">All services running normally</p>
            <p className="mt-0.5 text-sm text-emerald-800/80">
              If something isn&apos;t working for you,{" "}
              <Link href="/requests/new" className="font-medium underline underline-offset-2 hover:text-emerald-950">
                report an issue
              </Link>
              .
            </p>
          </div>
        </Card>
      ) : (
        <div
          role="status"
          className={cn("flex items-center gap-3 rounded-xl border p-4", hasMajor ? SEVERITY_META.major.panel : SEVERITY_META.minor.panel)}
        >
          <span className={cn("relative flex h-3 w-3 shrink-0")}>
            <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", hasMajor ? "bg-red-400" : "bg-amber-400")} />
            <span className={cn("relative inline-flex h-3 w-3 rounded-full", hasMajor ? "bg-red-500" : "bg-amber-500")} />
          </span>
          <div className="min-w-0">
            <p className={cn("text-base font-semibold", hasMajor ? "text-red-900" : "text-amber-900")}>
              {active.length === 1 ? "1 service has a problem right now" : `${active.length} services have problems right now`}
            </p>
            <p className={cn("text-sm", hasMajor ? "text-red-800/80" : "text-amber-800/90")}>
              Our team is on it. You don&apos;t need to report these again.
            </p>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div className="mt-5 space-y-5">
          {active.map((i) => {
            const team = i.team;
            const sev = severityOf(i.severity);
            const canManage = me.agentTeamIds.includes(i.team_id);
            const linked = (myTickets ?? []).filter((t) => t.incident_id === i.id);
            const affected = affectedCount.get(i.id) ?? 0;
            return (
              <Card key={i.id} className="overflow-hidden" aria-labelledby={`incident-${i.id}`}>
                <div aria-hidden className={cn("h-1", SEVERITY_META[sev].bar)} />
                <div className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={sev} />
                    {team && <TeamChip name={team.name} color={team.color} />}
                    {canManage && (
                      <Link
                        href={`/desk/incidents/${i.id}`}
                        className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
                      >
                        <Settings2 className="h-3.5 w-3.5" aria-hidden />
                        Manage
                      </Link>
                    )}
                  </div>
                  <div>
                    <h2 id={`incident-${i.id}`} className="text-lg font-semibold leading-snug text-slate-900">
                      {i.title}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Started {formatDateTime(i.started_at)} · going on for {durationText(minutesBetween(i.started_at))}
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-50 px-3 py-4">
                    <StatusSteps status={i.status} />
                    <p className="mt-3 text-center text-xs text-slate-600">{isIncidentStatus(i.status) ? INCIDENT_STATUS_META[i.status].hint : null}</p>
                  </div>

                  {linked.length > 0 && (
                    <p className="flex items-start gap-2 rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-900">
                      <TicketCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        Your request{linked.length > 1 ? "s" : ""}{" "}
                        {linked.map((t, n) => (
                          <span key={t.number}>
                            {n > 0 && ", "}
                            <Link href={`/requests/${t.number}`} className="font-medium underline underline-offset-2">
                              {ticketRef(t.number)}
                            </Link>
                          </span>
                        ))}{" "}
                        {linked.length > 1 ? "are" : "is"} part of this. We&apos;ll update {linked.length > 1 ? "them" : "it"} when it&apos;s fixed.
                      </span>
                    </p>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <AffectedToggle incidentId={i.id} subscribed={subscribed.has(i.id)} />
                    {me.isAgent && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <Users className="h-3.5 w-3.5" aria-hidden />
                        {affected === 0 ? "Nobody has said they're affected yet" : `${peopleCount(affected)} said they're affected`}
                      </span>
                    )}
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Updates</h3>
                    <IncidentTimeline updates={i.updates as TimelineUpdate[]} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <section className="mt-8" aria-labelledby="resolved-heading">
        <h2 id="resolved-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <History className="h-4 w-4 text-slate-400" aria-hidden />
          Resolved in the last 30 days
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{resolved.length}</span>
        </h2>
        {resolved.length === 0 ? (
          <Card className="px-5 py-6 text-center text-sm text-slate-500">No problems in the last 30 days.</Card>
        ) : (
          <Card className="divide-y divide-slate-100">
            {resolved.map((i) => {
              const sev = severityOf(i.severity);
              const updates = i.updates as TimelineUpdate[];
              return (
                <details key={i.id} className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-slate-50/70 sm:px-5 [&::-webkit-details-marker]:hidden">
                    <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_META[sev].dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800">{i.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        {i.team && (
                          <span className="font-medium" style={{ color: safeColor(i.team.color) }}>
                            {i.team.name}
                          </span>
                        )}
                        <span>{formatDate(i.started_at)}</span>
                        <span>Fixed in {durationText(minutesBetween(i.started_at, i.resolved_at))}</span>
                      </span>
                    </span>
                    <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="px-4 pb-4 pl-9 sm:px-5 sm:pl-10">
                    <p className="mb-3 text-xs text-slate-500">
                      {formatDateTime(i.started_at)} → {formatDateTime(i.resolved_at)}
                    </p>
                    <IncidentTimeline updates={updates} />
                  </div>
                </details>
              );
            })}
          </Card>
        )}
      </section>
    </div>
  );
}
