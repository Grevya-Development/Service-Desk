import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, GitMerge, Hourglass, Laptop, MessageCircleQuestion, UserCheck } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadTicket } from "@/lib/tickets/load";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ui/action-button";
import { ApprovalBadge, PriorityBadge, SlaBadge, TicketStatusBadge } from "@/components/tickets/badges";
import { AttachmentList, Conversation } from "@/components/tickets/conversation";
import { Composer } from "@/components/tickets/composer";
import { Markdown } from "@/components/markdown";
import { ticketRef } from "@/lib/constants";
import { slaStates } from "@/lib/sla";
import { formatDateTime, humanize } from "@/lib/utils";
import { assignToMe, markPending, recordTemplateUse, resolveTicket } from "../../actions";
import { PropertiesForm } from "../../_components/properties-form";
import { TeamChip } from "../../_components/team-chip";
import { ApprovalsCard, FormAnswers, RequesterCard, SlaCard, approverName, isGeneratedDescription } from "../../_components/ticket-cards";
import { FollowersCard, IncidentCard, MergeDialog, TicketHotkeys } from "../../_components/ticket-extras";

type Props = { params: Promise<{ number: string }> };

export async function generateMetadata({ params }: Props) {
  const { number } = await params;
  return { title: /^\d+$/.test(number) ? ticketRef(number) : "Ticket" };
}

export default async function AgentTicketPage({ params }: Props) {
  const me = await requireAgent();
  const { number } = await params;
  const { ticket, timeline, ticketAttachments, approvals } = await loadTicket(number);
  if (!me.agentTeamIds.includes(ticket.team_id)) redirect(`/requests/${ticket.number}`);

  const supabase = await createClient();
  const requester = ticket.requester;
  const [teamsRes, categoriesRes, membersRes, policyRes, managerRes, otherRes, assetsRes, cannedRes, firstNameRes, followersRes, incidentsRes, mergedIntoRes, mergedHereRes, adminsRes] = await Promise.all([
    supabase.from("teams").select("id, name, color, active, manages_assets").order("sort_order"),
    supabase.from("categories").select("id, name, team_id, active").order("sort_order").order("name"),
    supabase.from("team_members").select("team_id, person:people!employee_id(id, full_name, status)"),
    supabase.from("sla_policies").select("first_response_mins, resolution_mins").eq("team_id", ticket.team_id).eq("priority", ticket.priority).maybeSingle(),
    requester?.manager_id ? supabase.from("people").select("full_name").eq("id", requester.manager_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase
      .from("tickets")
      .select("id, number, subject, status")
      .eq("requester_id", ticket.requester_id)
      .in("status", ["new", "open", "pending"])
      .neq("id", ticket.id)
      .order("created_at", { ascending: false })
      .limit(8),
    me.managesAssets
      ? supabase.from("assets").select("id, asset_tag, name, status").eq("assigned_to", ticket.requester_id).order("asset_tag")
      : Promise.resolve({ data: null }),
    supabase.from("canned_responses").select("id, title, body").eq("team_id", ticket.team_id).order("use_count", { ascending: false }).order("title").limit(200),
    supabase.from("people").select("first_name").eq("id", ticket.requester_id).maybeSingle(),
    supabase.from("ticket_followers").select("created_at, person:people!employee_id(id, full_name, email, avatar_url)").eq("ticket_id", ticket.id).order("created_at"),
    supabase
      .from("incidents")
      .select("id, title, status, severity")
      .or(ticket.incident_id ? `and(team_id.eq.${ticket.team_id},status.neq.resolved),id.eq.${ticket.incident_id}` : `and(team_id.eq.${ticket.team_id},status.neq.resolved)`)
      .order("started_at", { ascending: false }),
    ticket.merged_into ? supabase.from("tickets").select("number, subject").eq("id", ticket.merged_into).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("tickets").select("id, number").eq("merged_into", ticket.id).order("number"),
    supabase.from("people").select("id").eq("role", "super_admin"),
  ]);

  const teams = teamsRes.data ?? [];
  const team = teams.find((t) => t.id === ticket.team_id);
  const isMember = me.memberships.some((m) => m.teamId === ticket.team_id);
  const awaitingApproval = ticket.approval_status === "pending";
  const done = ticket.status === "resolved" || ticket.status === "closed";
  const sla = slaStates(ticket);
  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  // Agents per team for the assignee picker; keep the current assignee selectable even if they left the team.
  const agents: { id: string; name: string; team_id: string }[] = [];
  for (const m of membersRes.data ?? []) {
    const p = m.person as unknown as { id: string; full_name: string | null; status: string } | null;
    if (p && p.status !== "exited") agents.push({ id: p.id, name: p.full_name ?? "Unnamed", team_id: m.team_id });
  }
  if (ticket.assignee && !agents.some((a) => a.id === ticket.assignee!.id && a.team_id === ticket.team_id)) {
    agents.push({ id: ticket.assignee.id, name: `${ticket.assignee.full_name ?? "Unnamed"} (not on team)`, team_id: ticket.team_id });
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));

  const categories = (categoriesRes.data ?? []).filter((c) => c.active || c.id === ticket.category_id);
  const requesterAssets = assetsRes.data;
  const showAssetField = Boolean(team?.manages_assets || me.managesAssets) && requesterAssets !== null;
  const assetOptions = showAssetField
    ? [
        ...(ticket.asset && !requesterAssets!.some((a) => a.id === ticket.asset!.id) ? [{ id: ticket.asset.id, name: `${ticket.asset.asset_tag} · ${ticket.asset.name}` }] : []),
        ...requesterAssets!.map((a) => ({ id: a.id, name: `${a.asset_tag} · ${a.name}` })),
      ]
    : null;

  const incidents = incidentsRes.data ?? [];
  const linkedIncident = ticket.incident_id ? (incidents.find((i) => i.id === ticket.incident_id) ?? null) : null;
  const activeIncidents = incidents.filter((i) => i.status !== "resolved");
  const followers = (followersRes.data ?? []).map((f) => f.person as unknown as { id: string; full_name: string | null; email: string; avatar_url: string | null } | null).filter((p) => p !== null);
  const supportIds = [...new Set([...agents.filter((a) => a.team_id === ticket.team_id).map((a) => a.id), ...(adminsRes.data ?? []).map((a) => a.id)])];
  const mergedInto = mergedIntoRes.data;
  const mergedHere = mergedHereRes.data ?? [];
  const showDescription = !(ticket.form_data && isGeneratedDescription(ticket.description, ticket.catalog_item?.fields, ticket.form_data));

  const resolveBlocked = awaitingApproval ? "Waiting for approval" : done ? "Already resolved" : undefined;
  const pendingBlocked = awaitingApproval ? "Waiting for approval" : ticket.status === "new" || ticket.status === "open" ? undefined : `Can't do this while ${humanize(ticket.status).toLowerCase()}`;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Ticket queue", href: "/desk" }, { label: ticketRef(ticket.number) }]}
        title={<span className="break-words">{ticket.subject}</span>}
        actions={
          <>
            <TicketHotkeys />
            {isMember && ticket.assignee_id !== me.id && (
              <span data-shortcut="assign" className="contents">
                <ActionButton action={assignToMe} fields={{ ticket_id: ticket.id }} variant="outline" title="Assign to me (a)">
                  <UserCheck className="h-3.5 w-3.5" /> Assign to me
                </ActionButton>
              </span>
            )}
            {!ticket.merged_into && <MergeDialog ticketId={ticket.id} ticketNumber={ticket.number} />}
            <ActionButton
              action={markPending}
              fields={{ ticket_id: ticket.id }}
              variant="outline"
              confirm="Ask the requester"
              prompt="Your question (sent to the requester as a reply). The SLA pauses until they answer."
              promptRequired
              disabled={Boolean(pendingBlocked)}
              title={pendingBlocked}
            >
              <MessageCircleQuestion className="h-3.5 w-3.5" /> Mark pending
            </ActionButton>
            <span data-shortcut="resolve" className="contents">
            <ActionButton
              action={resolveTicket}
              fields={{ ticket_id: ticket.id }}
              variant="success"
              confirm={`Resolve ${ticketRef(ticket.number)}`}
              prompt="Resolution note (sent to the requester as a reply)"
              promptRequired
              disabled={Boolean(resolveBlocked)}
              title={resolveBlocked ?? "Resolve (Shift+E)"}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
            </ActionButton>
            </span>
          </>
        }
      />

      {mergedInto !== null && ticket.merged_into && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <p>
            This ticket was merged into{" "}
            {mergedInto ? (
              <Link href={`/desk/tickets/${mergedInto.number}`} className="font-medium text-primary-700 underline">
                {ticketRef(mergedInto.number)} · {mergedInto.subject}
              </Link>
            ) : (
              "another ticket"
            )}
            . Carry on the conversation there.
          </p>
        </div>
      )}

      {awaitingApproval && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Waiting for approval from <strong>{pendingApprovals.length ? pendingApprovals.map(approverName).join(" and ") : "an approver"}</strong>; you can&apos;t
            change status until it&apos;s decided. The SLA starts once it&apos;s approved.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <div className="h-1 rounded-t-xl" style={{ backgroundColor: ticket.team?.color ?? "#2d48c8" }} />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-slate-700">{ticketRef(ticket.number)}</span>
                {ticket.team && <TeamChip name={ticket.team.name} color={ticket.team.color} />}
                <TicketStatusBadge status={ticket.status} audience="agent" />
                <PriorityBadge priority={ticket.priority} />
                <ApprovalBadge status={ticket.approval_status} />
                {ticket.asset && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <Laptop className="h-3.5 w-3.5" /> {ticket.asset.asset_tag}
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <SlaLine label="First response" state={sla.response} />
                <SlaLine label="Resolution" state={sla.resolution} />
              </div>
              <p className="text-xs text-slate-500">
                {ticket.catalog_item ? `Requested “${ticket.catalog_item.name}”` : humanize(ticket.type)}
                {ticket.category && <> · {ticket.category.name}</>} · Raised {formatDateTime(ticket.created_at)}
                {ticket.creator && ticket.creator.id !== ticket.requester_id && <> by {ticket.creator.full_name ?? "an agent"} on behalf of {requester?.full_name ?? "the requester"}</>}
                {ticket.legacy_ref && <> · Imported from {ticket.legacy_ref}</>}
              </p>
              {mergedHere.length > 0 && (
                <p className="text-xs text-slate-500">
                  Merged here:{" "}
                  {mergedHere.map((m, i) => (
                    <span key={m.id}>
                      {i > 0 && ", "}
                      <Link href={`/desk/tickets/${m.number}`} className="font-mono font-medium text-primary-600 hover:underline">
                        {ticketRef(m.number)}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={showDescription ? "Description" : "Request"} />
            <CardBody>
              {showDescription && <Markdown source={ticket.description} className="prose-doc break-words text-sm text-slate-700" />}
              {ticket.form_data && <FormAnswers fields={ticket.catalog_item?.fields} data={ticket.form_data} first={!showDescription} />}
              <AttachmentList files={ticketAttachments} className="mt-3" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Conversation" description="Replies go to the requester. Internal notes are visible to agents only." />
            <CardBody className="space-y-5">
              <Conversation items={timeline} requesterId={ticket.requester_id} audience="agent" agentIds={supportIds} />
              {ticket.merged_into ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Replies are off because this ticket was merged.</p>
              ) : (
                <Composer
                  ticketId={ticket.id}
                  canNote
                  hotkeys
                  articles
                  templates={cannedRes.data ?? []}
                  placeholders={{ first_name: firstNameRes.data?.first_name ?? requester?.full_name?.split(" ")[0] ?? "there", ticket: ticketRef(ticket.number), agent_name: me.name }}
                  onTemplateUse={recordTemplateUse}
                />
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Properties" />
            <CardBody>
              <PropertiesForm
                key={ticket.updated_at}
                ticket={{
                  id: ticket.id,
                  status: ticket.status,
                  priority: ticket.priority,
                  team_id: ticket.team_id,
                  category_id: ticket.category_id,
                  assignee_id: ticket.assignee_id,
                  asset_id: ticket.asset_id,
                  approval_status: ticket.approval_status,
                }}
                teams={teams.map((t) => ({ id: t.id, name: t.name, active: t.active }))}
                categories={categories.map((c) => ({ id: c.id, name: c.name, team_id: c.team_id }))}
                agents={agents}
                assets={assetOptions}
                meId={me.id}
              />
            </CardBody>
          </Card>

          <RequesterCard
            person={requester}
            managerName={managerRes.data?.full_name ?? null}
            openTickets={otherRes.data ?? []}
            assets={requesterAssets}
            linkAssets={me.managesAssets}
          />

          <FollowersCard ticketId={ticket.id} followers={followers} requesterId={ticket.requester_id} canEdit={!ticket.merged_into} />

          {(linkedIncident || activeIncidents.length > 0) && <IncidentCard ticketId={ticket.id} linked={linkedIncident} active={activeIncidents} />}

          <SlaCard
            response={sla.response}
            resolution={sla.resolution}
            policy={policyRes.data}
            respondedAt={ticket.first_responded_at}
            resolvedAt={ticket.resolved_at}
            pausedMinutes={ticket.sla_paused_minutes}
            pendingSince={ticket.pending_since}
          />

          <ApprovalsCard approvals={approvals} />
        </aside>
      </div>
    </div>
  );
}

function SlaLine({ label, state }: { label: string; state: ReturnType<typeof slaStates>["response"] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <SlaBadge state={state} />
      {state.due && <span className="text-xs text-slate-500">due {formatDateTime(state.due)}</span>}
    </div>
  );
}
