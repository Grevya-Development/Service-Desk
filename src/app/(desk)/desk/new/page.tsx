import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { NewTicketForm } from "../_components/new-ticket-form";

export const metadata = { title: "New ticket" };

export default async function NewDeskTicketPage() {
  const me = await requireAgent();
  const supabase = await createClient();

  const [{ data: teams }, { data: categories }, { data: members }, { data: employees }] = await Promise.all([
    supabase.from("teams").select("id, name").in("id", me.agentTeamIds).eq("active", true).order("sort_order"),
    supabase.from("categories").select("id, name, team_id").in("team_id", me.agentTeamIds).eq("active", true).order("sort_order").order("name"),
    supabase.from("team_members").select("team_id, person:people!employee_id(id, full_name, status)").in("team_id", me.agentTeamIds),
    supabase.from("people").select("id, full_name, email, department, designation").neq("status", "exited").order("full_name"),
  ]);

  const agents: { id: string; name: string; team_id: string }[] = [];
  for (const m of members ?? []) {
    const p = m.person as unknown as { id: string; full_name: string | null; status: string } | null;
    if (p && p.status !== "exited") agents.push({ id: p.id, name: p.full_name ?? "Unnamed", team_id: m.team_id });
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New ticket"
        description="Raise a ticket for an employee, for example after a call or a walk-up. They'll be notified and can follow it under My requests."
        breadcrumbs={[{ label: "Ticket queue", href: "/desk" }, { label: "New ticket" }]}
      />
      <Card>
        <CardBody className="p-5 sm:p-6">
          {teams && teams.length ? (
            <NewTicketForm
              employees={employees ?? []}
              teams={teams}
              categories={categories ?? []}
              agents={agents}
              meId={me.id}
              memberTeamIds={me.memberships.map((m) => m.teamId)}
            />
          ) : (
            <EmptyState title="You're not on an active team" description="Ask a team lead to add you to a team before raising tickets for others." />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
