import Link from "next/link";
import { Boxes, Coffee, Plus, Settings2, Shuffle, Ticket, Users } from "lucide-react";
import { requireLead } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES } from "@/lib/constants";
import { orgToday } from "@/lib/utils";
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { NamedIcon, TEAM_ICONS } from "../_lib/icons";
import { TeamForm } from "./_components/team-form";

export const metadata = { title: "Teams & agents" };

type MemberRow = { team_id: string; employee_id: string; role: string; person: { full_name: string | null; avatar_url: string | null } | null };

export default async function AdminTeamsPage() {
  const me = await requireLead();
  const supabase = await createClient();

  let query = supabase
    .from("teams")
    .select("id, key, name, description, color, icon, manages_assets, auto_assign, active, sort_order, open:tickets(count)")
    .in("tickets.status", OPEN_STATUSES)
    .order("sort_order")
    .order("name");
  if (!me.isAdmin) query = query.in("id", me.leadTeamIds.length ? me.leadTeamIds : ["00000000-0000-0000-0000-000000000000"]);
  const today = orgToday();
  const [{ data: teams }, { data: members }, { data: awayRows }] = await Promise.all([
    query,
    supabase.from("team_members").select("team_id, employee_id, role, person:people!employee_id(full_name, avatar_url)"),
    supabase.from("agent_profiles").select("employee_id, away_until").eq("away", true),
  ]);
  // Same rule as the database's is_away(): no end date, or it hasn't passed yet.
  const awayIds = new Set((awayRows ?? []).filter((a) => !a.away_until || a.away_until >= today).map((a) => a.employee_id));

  const byTeam = new Map<string, MemberRow[]>();
  for (const m of (members ?? []) as MemberRow[]) byTeam.set(m.team_id, [...(byTeam.get(m.team_id) ?? []), m]);

  return (
    <>
      <PageHeader
        title="Teams & agents"
        description={me.isAdmin ? "Every team on the desk, who works in it and how tickets reach them." : "The teams you lead, who works in them and how tickets reach them."}
        breadcrumbs={[{ label: "Administration" }, { label: "Teams & agents" }]}
        actions={
          me.isAdmin && (
            <Dialog
              title="New team"
              description="A team gets its own queue, categories, SLA targets and service catalog."
              size="lg"
              trigger={
                <Button>
                  <Plus className="h-4 w-4" />
                  New team
                </Button>
              }
            >
              <TeamForm isAdmin />
            </Dialog>
          )
        }
      />

      {!teams?.length ? (
        <Card>
          <EmptyState icon={Users} title="No teams yet" description={me.isAdmin ? "Create the first team to start taking tickets." : "You don't lead any active team."} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {teams.map((t) => {
            const rows = byTeam.get(t.id) ?? [];
            const leads = rows.filter((m) => m.role === "lead");
            const open = t.open?.[0]?.count ?? 0;
            const away = rows.filter((m) => awayIds.has(m.employee_id)).length;
            return (
              <Card key={t.id} className={`overflow-hidden ${t.active ? "" : "opacity-80"}`}>
                <div className="h-1.5" style={{ backgroundColor: t.color }} />
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: t.color }}>
                      <NamedIcon name={t.icon} set={TEAM_ICONS} className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-slate-900">{t.name}</h2>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{t.key}</code>
                        {!t.active && <Badge tone="gray">Inactive</Badge>}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{t.description || "No description yet."}</p>
                    </div>
                  </div>

                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 px-2 py-2">
                      <dt className="text-[11px] font-medium text-slate-500">Members</dt>
                      <dd className="text-lg font-semibold text-slate-900">{rows.length}</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-2">
                      <dt className="text-[11px] font-medium text-slate-500">Leads</dt>
                      <dd className="text-lg font-semibold text-slate-900">{leads.length}</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-2">
                      <dt className="text-[11px] font-medium text-slate-500">Open tickets</dt>
                      <dd className="text-lg font-semibold text-slate-900">{open}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <Badge tone={t.auto_assign ? "blue" : "gray"} className="gap-1">
                      <Shuffle className="h-3 w-3" />
                      {t.auto_assign ? "Auto-assign on" : "Manual assignment"}
                    </Badge>
                    {away > 0 && (
                      <Badge tone="yellow" className="gap-1">
                        <Coffee className="h-3 w-3" />
                        {away} away{t.auto_assign ? ", skipped by auto-assign" : ""}
                      </Badge>
                    )}
                    {t.manages_assets && (
                      <Badge tone="teal" className="gap-1">
                        <Boxes className="h-3 w-3" />
                        Manages assets
                      </Badge>
                    )}
                    {t.active && (
                      <Badge tone="green" className="gap-1">
                        <Ticket className="h-3 w-3" />
                        Taking tickets
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Leads</p>
                      {leads.length ? (
                        <div className="mt-1 flex items-center gap-2">
                          <div className="flex -space-x-2">
                            {leads.slice(0, 4).map((l, i) => (
                              <Avatar key={i} name={l.person?.full_name} src={l.person?.avatar_url} size="xs" />
                            ))}
                          </div>
                          <span className="truncate text-xs text-slate-600">
                            {leads
                              .slice(0, 2)
                              .map((l) => l.person?.full_name ?? "Unknown")
                              .join(", ")}
                            {leads.length > 2 && ` +${leads.length - 2}`}
                          </span>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-amber-700">No lead yet</p>
                      )}
                      {rows.length === 0 && <p className="mt-1 text-xs text-slate-500">Add agents so tickets can be worked.</p>}
                    </div>
                    <div className="flex gap-2">
                      <Dialog
                        title={`Edit ${t.name}`}
                        size="lg"
                        trigger={
                          <Button variant="outline" size="sm">
                            <Settings2 className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                        }
                      >
                        <TeamForm
                          isAdmin={me.isAdmin}
                          team={{
                            id: t.id,
                            key: t.key,
                            name: t.name,
                            description: t.description,
                            color: t.color,
                            icon: t.icon,
                            manages_assets: t.manages_assets,
                            auto_assign: t.auto_assign,
                            active: t.active,
                          }}
                        />
                      </Dialog>
                      <Link href={`/admin/teams/${t.id}`} className={buttonClass("primary", "sm")}>
                        <Users className="h-3.5 w-3.5" />
                        Members
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
