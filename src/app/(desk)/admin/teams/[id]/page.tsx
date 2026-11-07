import { notFound } from "next/navigation";
import { Boxes, Coffee, Crown, Settings2, Shuffle, UserMinus, UserPlus, Users } from "lucide-react";
import { requireLead } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OPEN_STATUSES } from "@/lib/constants";
import { formatDate, orgToday } from "@/lib/utils";
import { Avatar, Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ActionButton } from "@/components/ui/action-button";
import { Dialog } from "@/components/ui/dialog";
import { NamedIcon, TEAM_ICONS } from "../../_lib/icons";
import { isUuid } from "../../_lib/validate";
import { removeMember, setAgentAvailability, setMemberRole } from "../actions";
import { AddMemberForm } from "../_components/add-member-form";
import { TeamForm } from "../_components/team-form";

export const metadata = { title: "Team" };

type Member = {
  employee_id: string;
  role: string;
  created_at: string;
  person: { full_name: string | null; email: string; avatar_url: string | null; designation: string | null; department: string | null; status: string } | null;
};

export default async function AdminTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireLead();
  if (!isUuid(id) || !me.leadTeamIds.includes(id)) notFound();
  const supabase = await createClient();

  const [{ data: team }, { data: memberRows }, { data: people }, { data: openRows }] = await Promise.all([
    supabase.from("teams").select("id, key, name, description, color, icon, manages_assets, auto_assign, active").eq("id", id).maybeSingle(),
    supabase
      .from("team_members")
      .select("employee_id, role, created_at, person:people!employee_id(full_name, email, avatar_url, designation, department, status)")
      .eq("team_id", id)
      .order("created_at"),
    supabase.from("people").select("id, full_name, email, department, designation, avatar_url").neq("status", "exited").order("full_name"),
    supabase.from("tickets").select("assignee_id").eq("team_id", id).in("status", OPEN_STATUSES).not("assignee_id", "is", null).limit(5000),
  ]);
  if (!team) notFound();

  // Availability (same rule as the database's is_away(): away, and no end date or it hasn't passed).
  const today = orgToday();
  const { data: profiles } = memberRows?.length
    ? await supabase.from("agent_profiles").select("employee_id, away, away_until").in("employee_id", memberRows.map((m) => m.employee_id))
    : { data: [] };
  const awayUntil = new Map<string, string | null>();
  for (const p of profiles ?? []) if (p.away && (!p.away_until || p.away_until >= today)) awayUntil.set(p.employee_id, p.away_until);
  const awayCount = awayUntil.size;

  const members = ((memberRows ?? []) as Member[]).sort((a, b) => (a.role === b.role ? 0 : a.role === "lead" ? -1 : 1));
  const memberIds = new Set(members.map((m) => m.employee_id));
  const candidates = (people ?? []).filter((p) => !memberIds.has(p.id));
  const openByAgent = new Map<string, number>();
  for (const r of openRows ?? []) if (r.assignee_id) openByAgent.set(r.assignee_id, (openByAgent.get(r.assignee_id) ?? 0) + 1);
  const leadCount = members.filter((m) => m.role === "lead").length;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ backgroundColor: team.color }}>
              <NamedIcon name={team.icon} set={TEAM_ICONS} className="h-5 w-5" />
            </span>
            {team.name}
            {!team.active && <Badge tone="gray">Inactive</Badge>}
          </span>
        }
        description={team.description ?? undefined}
        breadcrumbs={[{ label: "Administration" }, { label: "Teams & agents", href: "/admin/teams" }, { label: team.name }]}
        actions={
          <>
            <Dialog
              title={`Edit ${team.name}`}
              size="lg"
              trigger={
                <Button variant="outline">
                  <Settings2 className="h-4 w-4" />
                  Edit team
                </Button>
              }
            >
              <TeamForm isAdmin={me.isAdmin} team={team} />
            </Dialog>
            <Dialog
              title="Add someone to the team"
              description={`They'll see ${team.name}'s tickets in their queue.`}
              trigger={
                <Button>
                  <UserPlus className="h-4 w-4" />
                  Add agent
                </Button>
              }
            >
              <AddMemberForm teamId={team.id} people={candidates} />
            </Dialog>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Members"
            description={`${members.length} ${members.length === 1 ? "person" : "people"} · ${leadCount} ${leadCount === 1 ? "lead" : "leads"}${awayCount ? ` · ${awayCount} away` : ""}`}
          />
          {members.length === 0 ? (
            <EmptyState icon={Users} title="No one is on this team yet" description="Add agents so they can pick up this team's tickets." />
          ) : (
            <Table className="relative">
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH className="hidden md:table-cell">Department</TH>
                  <TH>Role</TH>
                  <TH>Availability</TH>
                  <TH className="text-right">Open tickets</TH>
                  <TH className="hidden sm:table-cell">Joined team</TH>
                  <TH className="text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {members.map((m) => {
                  const p = m.person;
                  const isLead = m.role === "lead";
                  const lastLead = isLead && leadCount === 1;
                  const lockLast = lastLead && !me.isAdmin;
                  const name = p?.full_name ?? p?.email ?? "Unknown";
                  const open = openByAgent.get(m.employee_id) ?? 0;
                  const away = awayUntil.has(m.employee_id);
                  const until = awayUntil.get(m.employee_id);
                  return (
                    <TR key={m.employee_id}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <Avatar name={name} src={p?.avatar_url} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800">
                              {name}
                              {m.employee_id === me.id && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                            </p>
                            <p className="truncate text-xs text-slate-500">{p?.designation ?? p?.email}</p>
                            {p?.status === "exited" && <Badge tone="red" className="mt-1">Left the company</Badge>}
                          </div>
                        </div>
                      </TD>
                      <TD className="hidden md:table-cell">{p?.department ?? "—"}</TD>
                      <TD>
                        {isLead ? (
                          <Badge tone="purple" className="gap-1">
                            <Crown className="h-3 w-3" />
                            Lead
                          </Badge>
                        ) : (
                          <Badge tone="blue">Agent</Badge>
                        )}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {away ? (
                            <Badge tone="yellow" className="gap-1">
                              <Coffee className="h-3 w-3" aria-hidden />
                              Away{until ? ` until ${formatDate(until)}` : ""}
                            </Badge>
                          ) : (
                            <Badge tone="green">Available</Badge>
                          )}
                          {me.isAdmin && (
                            <ActionButton
                              action={setAgentAvailability}
                              fields={{ team_id: team.id, employee_id: m.employee_id, away: !away }}
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              title={away ? `Mark ${name} as available` : `Mark ${name} as away`}
                            >
                              {away ? "Set available" : "Set away"}
                            </ActionButton>
                          )}
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums">{open}</TD>
                      <TD className="hidden whitespace-nowrap sm:table-cell">{formatDate(m.created_at)}</TD>
                      <TD>
                        <div className="flex justify-end gap-1.5">
                          <ActionButton
                            action={setMemberRole}
                            fields={{ team_id: team.id, employee_id: m.employee_id, role: isLead ? "agent" : "lead" }}
                            variant="ghost"
                            disabled={lockLast}
                            title={lockLast ? "Every team needs at least one lead" : undefined}
                            confirm={isLead ? `Make ${name} an agent? They will no longer be able to manage this team.` : undefined}
                          >
                            {isLead ? "Make agent" : "Make lead"}
                          </ActionButton>
                          <ActionButton
                            action={removeMember}
                            fields={{ team_id: team.id, employee_id: m.employee_id }}
                            variant="danger"
                            className="bg-white text-red-600 shadow-none ring-1 ring-red-200 hover:bg-red-50"
                            disabled={lockLast}
                            title={lockLast ? "You can't remove the last lead" : `Remove ${name}`}
                            confirm={`Remove ${name} from ${team.name}?${open ? ` Their ${open} open ticket${open === 1 ? "" : "s"} stay assigned to them until someone reassigns ${open === 1 ? "it" : "them"}.` : ""}`}
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                            <span className="sr-only sm:not-sr-only">Remove</span>
                          </ActionButton>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="How tickets reach this team" />
            <CardBody className="space-y-4 text-sm">
              <div className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <Shuffle className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-medium text-slate-800">Auto-assign is {team.auto_assign ? "on" : "off"}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    {team.auto_assign
                      ? "Each new ticket is handed to the available team member with the fewest open tickets. If two people are tied, the one who joined the team first gets it. Requests that need approval are handed out once approved."
                      : "New tickets wait in the team's Unassigned queue until an agent picks one up or a lead assigns it. Leads are told about new urgent and high-priority tickets."}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <Coffee className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-medium text-slate-800">Away agents</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    {team.auto_assign ? "Auto-assign skips anyone marked Away. " : "If you turn on auto-assign, it skips anyone marked Away. "}
                    {me.isAdmin
                      ? "Agents set this from their own menu; as a desk admin you can also change it here."
                      : "Agents set this from their own menu (or ask a desk admin). Their tickets stay assigned while they're away."}
                  </p>
                </div>
              </div>
              {team.manages_assets && (
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                    <Boxes className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-medium text-slate-800">Manages company assets</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">Everyone on this team can see and update the asset register.</p>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                  <Crown className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-medium text-slate-800">Agents and leads</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    Agents work the team&apos;s tickets and write help articles. Leads can also add or remove people, change categories, SLA targets and the service
                    catalog, and approve requests that need a lead&apos;s OK.
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
