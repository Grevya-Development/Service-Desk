import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, Info, Megaphone, ShieldCheck } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LinkTabs } from "@/components/ui/link-tabs";
import { buttonClass, Card, EmptyState, PageHeader, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { UUID_RE, durationText, minutesBetween, severityOf } from "../../status/_lib/incident";
import { IncidentStatusBadge, SeverityBadge, TeamChip } from "../../status/_components/incident-bits";
import { DeclareIncidentDialog } from "./_components/incident-forms";

export const metadata: Metadata = { title: "Incidents" };

type SP = Record<string, string | string[] | undefined>;
type Show = "all" | "active" | "resolved";
type Filters = { show: Show; team: string | null };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const shortDuration = (m: number) => (m < 1 ? "<1m" : durationText(m));
const countOf = (rel: { count: number }[] | null | undefined) => rel?.[0]?.count ?? 0;

function listHref({ show, team }: Filters) {
  const sp = new URLSearchParams();
  if (show !== "all") sp.set("show", show);
  if (team) sp.set("team", team);
  const s = sp.toString();
  return s ? `/desk/incidents?${s}` : "/desk/incidents";
}

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireAgent();
  const sp = await searchParams;
  const rawShow = first(sp.show);
  const rawTeam = first(sp.team);
  const filters: Filters = {
    show: rawShow === "active" || rawShow === "resolved" ? rawShow : "all",
    team: rawTeam && UUID_RE.test(rawTeam) && me.agentTeamIds.includes(rawTeam) ? rawTeam : null,
  };
  const canonical = listHref(filters);
  const currentQs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v === undefined ? [] : [[k, v]]))).toString();
  if (canonical !== (currentQs ? `/desk/incidents?${currentQs}` : "/desk/incidents")) redirect(canonical);

  const supabase = await createClient();
  const teamIds = filters.team ? [filters.team] : me.agentTeamIds;
  const ids = teamIds.length ? teamIds : ["00000000-0000-0000-0000-000000000000"];

  const [{ data: teamRows }, { data: rows, error }, { count: otherActive }] = await Promise.all([
    supabase.from("teams").select("id, name, color, active").in("id", me.agentTeamIds.length ? me.agentTeamIds : ids).order("sort_order"),
    supabase
      .from("incidents")
      .select("id, title, summary, status, severity, started_at, resolved_at, team_id, linked:tickets(count), affected:incident_subscribers(count)")
      .in("team_id", ids)
      .order("started_at", { ascending: false })
      .limit(300),
    // Active incidents of teams the viewer doesn't work for (the sidebar badge counts every team).
    me.isAdmin
      ? Promise.resolve({ count: 0 })
      : supabase
          .from("incidents")
          .select("id", { count: "exact", head: true })
          .neq("status", "resolved")
          .not("team_id", "in", `(${(me.agentTeamIds.length ? me.agentTeamIds : ids).join(",")})`),
  ]);
  const teams = (teamRows ?? []).filter((t) => t.active);
  const teamById = new Map((teamRows ?? []).map((t) => [t.id, t]));

  const all = [...(rows ?? [])].sort((a, b) => {
    const ar = a.status === "resolved" ? 1 : 0;
    const br = b.status === "resolved" ? 1 : 0;
    return ar - br || b.started_at.localeCompare(a.started_at);
  });
  const activeCount = all.filter((i) => i.status !== "resolved").length;
  const visible = filters.show === "active" ? all.filter((i) => i.status !== "resolved") : filters.show === "resolved" ? all.filter((i) => i.status === "resolved") : all;

  const tabs = [
    { label: "All", show: "all" as const, count: all.length },
    { label: "Active", show: "active" as const, count: activeCount },
    { label: "Resolved", show: "resolved" as const, count: all.length - activeCount },
  ].map((t) => ({ label: t.label, count: t.count, href: listHref({ ...filters, show: t.show }) }));

  const multiTeam = teams.length > 1;
  const declare = teams.length ? <DeclareIncidentDialog teams={teams.map((t) => ({ id: t.id, name: t.name }))} defaultTeamId={filters.team ?? undefined} /> : null;

  return (
    <div>
      <PageHeader
        title="Incidents"
        description="When something is down for several people, declare an incident. Everyone sees it on Service status and can ask to be told when it's fixed."
        breadcrumbs={[{ label: "Agent workspace", href: "/desk" }, { label: "Incidents" }]}
        actions={
          <>
            <Link href="/status" className={buttonClass("outline")}>
              <ExternalLink className="h-4 w-4" aria-hidden />
              View status page
            </Link>
            {declare}
          </>
        }
      />

      <LinkTabs tabs={tabs} />

      {(otherActive ?? 0) > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          <Info className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <span>
            Other teams have {otherActive} active {otherActive === 1 ? "incident" : "incidents"}. You can follow {otherActive === 1 ? "it" : "them"} on{" "}
            <Link href="/status" className="font-medium text-primary-700 underline-offset-2 hover:underline">
              Service status
            </Link>
            .
          </span>
        </p>
      )}

      <Card>
        {teams.length > 1 && (
          <form action="/desk/incidents" method="get" className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
            {filters.show !== "all" && <input type="hidden" name="show" value={filters.show} />}
            <label htmlFor="inc-team" className="sr-only">
              Team
            </label>
            <Select id="inc-team" name="team" defaultValue={filters.team ?? ""} className="sm:w-56">
              <option value="">All my teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <button type="submit" className={buttonClass("secondary")}>
              Apply
            </button>
          </form>
        )}

        {error ? (
          <EmptyState icon={Megaphone} title="We couldn't load incidents" description="Please refresh the page in a moment." />
        ) : visible.length === 0 ? (
          filters.show === "resolved" ? (
            <EmptyState icon={ShieldCheck} title="No resolved incidents yet" description="Incidents you resolve will be listed here." />
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="No active incidents"
              description="All good. If several people report the same problem, declare an incident so everyone knows you're on it."
              action={declare}
            />
          )
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Incident</TH>
                {multiTeam && <TH>Team</TH>}
                <TH>Status</TH>
                <TH>Started</TH>
                <TH className="text-right">Tickets</TH>
                <TH className="text-right">Affected</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((i) => {
                const team = teamById.get(i.team_id);
                const resolved = i.status === "resolved";
                return (
                  <TR key={i.id} className={resolved ? "text-slate-500" : undefined}>
                    <TD className="min-w-[16rem] max-w-md">
                      <div className="flex items-start gap-2">
                        <SeverityBadge severity={severityOf(i.severity)} className="mt-px shrink-0" />
                        <div className="min-w-0">
                          <Link href={`/desk/incidents/${i.id}`} className="font-medium text-slate-900 hover:text-primary-700">
                            {i.title}
                          </Link>
                          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{i.summary}</p>
                        </div>
                      </div>
                    </TD>
                    {multiTeam && <TD>{team ? <TeamChip name={team.name} color={team.color} /> : "—"}</TD>}
                    <TD>
                      <IncidentStatusBadge status={i.status} />
                    </TD>
                    <TD className="whitespace-nowrap text-xs">
                      <span className="block text-slate-600">{formatDateTime(i.started_at)}</span>
                      <span className="block text-slate-400">
                        {resolved ? "Fixed in " : "For "}
                        {shortDuration(minutesBetween(i.started_at, i.resolved_at))}
                      </span>
                    </TD>
                    <TD className="text-right tabular-nums">{countOf(i.linked)}</TD>
                    <TD className="text-right tabular-nums">{countOf(i.affected)}</TD>
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
