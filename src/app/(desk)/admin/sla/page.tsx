import Link from "next/link";
import { CalendarClock, Gauge, Timer } from "lucide-react";
import { requireLead } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PRIORITY_META, isPriority, type Priority } from "@/lib/constants";
import { formatTarget } from "@/lib/sla";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { PriorityDot } from "@/components/tickets/badges";
import { pickTeam } from "../_lib/access";
import { loadLeadTeams } from "../_lib/data";
import { WEEKDAYS } from "../_lib/validate";
import { TeamSwitcher } from "../_components/team-switcher";
import { SlaForm, type SlaRow } from "./_components/sla-form";

export const metadata = { title: "SLA targets" };

const ORDER: Priority[] = ["urgent", "high", "medium", "low"];
const DEFAULTS: Record<Priority, [number, number]> = { urgent: [30, 240], high: [60, 480], medium: [240, 1440], low: [480, 2400] };

type Hours = { days?: number[]; start?: string; end?: string; timezone?: string };

function describeHours(h: Hours) {
  const days = (h.days ?? []).slice().sort((a, b) => a - b);
  const names = WEEKDAYS.filter((d) => days.includes(d.iso)).map((d) => d.short);
  const contiguous = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayText = contiguous ? `${names[0]}–${names[names.length - 1]}` : names.join(", ");
  return `${dayText || "No days"}, ${h.start ?? "?"}–${h.end ?? "?"} (${h.timezone ?? "Asia/Kolkata"})`;
}

export default async function AdminSlaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireLead();
  const sp = await searchParams;
  const supabase = await createClient();
  const teams = await loadLeadTeams(supabase, me);
  const team = pickTeam(teams, sp.team);

  const header = (
    <PageHeader
      title="SLA targets"
      description="How quickly each team promises to reply to and fix tickets, by priority. The desk tracks every ticket against these targets and warns agents before they slip."
      breadcrumbs={[{ label: "Administration" }, { label: "SLA targets" }]}
    />
  );
  if (!team) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={Gauge} title="No teams to manage" description="You'll see SLA targets here once you lead a team." />
        </Card>
      </>
    );
  }

  const [{ data: policies }, { data: hoursRow }] = await Promise.all([
    supabase.from("sla_policies").select("priority, first_response_mins, resolution_mins").eq("team_id", team.id),
    supabase.from("settings").select("value").eq("key", "business_hours").maybeSingle(),
  ]);
  const byPriority = new Map((policies ?? []).filter((r) => isPriority(r.priority)).map((r) => [r.priority as Priority, r]));
  const rows: SlaRow[] = ORDER.map((p) => {
    const r = byPriority.get(p);
    return { priority: p, first_response_mins: r?.first_response_mins ?? DEFAULTS[p][0], resolution_mins: r?.resolution_mins ?? DEFAULTS[p][1] };
  });
  const missing = ORDER.filter((p) => !byPriority.has(p));
  const hours = (hoursRow?.value ?? {}) as Hours;

  return (
    <>
      {header}
      <TeamSwitcher teams={teams} selectedId={team.id} basePath="/admin/sla" />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="h-1" style={{ backgroundColor: team.color }} />
          <CardHeader
            title={`${team.name} targets`}
            description={missing.length ? "Some priorities have no target yet; suggested defaults are filled in. Save to apply them." : "Change any value, then save."}
          />
          <SlaForm key={team.id} teamId={team.id} rows={rows} />
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Current targets" description="What's saved right now." />
            <CardBody className="p-0">
              <ul className="divide-y divide-slate-100">
                {ORDER.map((p) => {
                  const r = byPriority.get(p);
                  return (
                    <li key={p} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <PriorityDot priority={p} />
                      {r ? (
                        <span className="text-xs text-slate-600">
                          Reply <span className="font-semibold text-slate-800">{formatTarget(r.first_response_mins)}</span> · Fix{" "}
                          <span className="font-semibold text-slate-800">{formatTarget(r.resolution_mins)}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-amber-700">Not set: no SLA for {PRIORITY_META[p].label.toLowerCase()} tickets</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="How the clock works" />
            <CardBody className="space-y-3 text-xs leading-relaxed text-slate-600">
              <p className="flex gap-2">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
                <span>
                  Targets count <strong>business time</strong> only: {describeHours(hours)}. Nights, weekends and public holidays are skipped.
                  {me.isAdmin ? (
                    <>
                      {" "}
                      Change working hours in{" "}
                      <Link href="/admin/settings" className="font-medium text-primary-600 hover:underline">
                        Settings
                      </Link>
                      .
                    </>
                  ) : (
                    " A desk admin sets these hours."
                  )}
                </span>
              </p>
              <p className="flex gap-2">
                <Timer className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
                <span>
                  In this form, one business day = 9 working hours. <strong>First response</strong> is the first public reply from someone other than the requester.{" "}
                  <strong>Resolve</strong> is when the ticket is marked resolved.
                </span>
              </p>
              <p className="flex gap-2">
                <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
                <span>
                  The clock pauses while a ticket waits on the requester, and for requests it starts once approved. Changes apply to new tickets and to tickets whose
                  priority changes; others keep their current due times.
                </span>
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
