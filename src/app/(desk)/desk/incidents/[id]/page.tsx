import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Link2Off, Lock, Ticket, Trash2, Users } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionButton } from "@/components/ui/action-button";
import { Avatar, buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { TicketStatusBadge } from "@/components/tickets/badges";
import { OPEN_STATUSES, ticketRef } from "@/lib/constants";
import { cn, formatDateTime } from "@/lib/utils";
import { INCIDENT_STATUS_META, SEVERITY_META, UUID_RE, durationText, isIncidentStatus, minutesBetween, peopleCount, severityOf } from "../../../status/_lib/incident";
import { IncidentTimeline, SeverityBadge, StatusSteps, TeamChip, type TimelineUpdate } from "../../../status/_components/incident-bits";
import { EditIncidentDialog, LinkTicketsForm, PostUpdateForm, ResolveIncidentDialog } from "../_components/incident-forms";
import { deleteIncident, unlinkTicket } from "../actions";

export const metadata: Metadata = { title: "Incident" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAgent();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();

  const { data: incident } = await supabase
    .from("incidents")
    .select(
      "id, title, summary, status, severity, started_at, resolved_at, team_id, team:teams(id, name, color), creator:people!created_by(full_name, avatar_url), updates:incident_updates(id, status, body, created_at, author:people!author_id(full_name, avatar_url))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!incident) notFound();

  const crumbs = [{ label: "Agent workspace", href: "/desk" }, { label: "Incidents", href: "/desk/incidents" }, { label: incident.title }];

  if (!me.agentTeamIds.includes(incident.team_id)) {
    return (
      <div>
        <PageHeader title={incident.title} breadcrumbs={crumbs} />
        <Card>
          <EmptyState
            icon={Lock}
            title={`This incident belongs to ${incident.team?.name ?? "another team"}`}
            description="Only their agents can post updates or change it. You can follow it on the Service status page."
            action={
              <Link href="/status" className={buttonClass("primary")}>
                Open Service status
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const [{ data: tickets }, { data: subs }] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, number, subject, status, team_id, requester_id, updated_at, requester:people!requester_id(full_name, avatar_url)")
      .eq("incident_id", incident.id)
      .order("number", { ascending: true }),
    supabase.from("incident_subscribers").select("employee_id").eq("incident_id", incident.id),
  ]);
  const linked = tickets ?? [];
  const openLinked = linked.filter((t) => (OPEN_STATUSES as string[]).includes(t.status));
  const subscriberCount = subs?.length ?? 0;
  const notifyCount = new Set([...(subs ?? []).map((s) => s.employee_id), ...openLinked.map((t) => t.requester_id)]).size;

  const resolved = incident.status === "resolved";
  const sev = severityOf(incident.severity);
  const canDelete = me.leadTeamIds.includes(incident.team_id);
  const updates = incident.updates as TimelineUpdate[];

  return (
    <div>
      <PageHeader
        title={incident.title}
        breadcrumbs={crumbs}
        actions={
          <>
            {!resolved && (
              <span className="lg:hidden">
                <ResolveIncidentDialog id={incident.id} openTickets={openLinked.length} notifyCount={notifyCount} />
              </span>
            )}
            <Link href="/status" className={buttonClass("outline", "sm")}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              As employees see it
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card className="overflow-hidden">
            <div aria-hidden className={cn("h-1", resolved ? "bg-emerald-500" : SEVERITY_META[sev].bar)} />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={sev} />
                {incident.team && <TeamChip name={incident.team.name} color={incident.team.color} />}
                <span className="text-xs text-slate-500">
                  {resolved
                    ? `Fixed in ${durationText(minutesBetween(incident.started_at, incident.resolved_at))}`
                    : `Going on for ${durationText(minutesBetween(incident.started_at))}`}
                </span>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-4">
                <StatusSteps status={incident.status} />
                <p className="mt-3 text-center text-xs text-slate-600">{isIncidentStatus(incident.status) ? INCIDENT_STATUS_META[incident.status].hint : null}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">What people see</p>
                <p className="whitespace-pre-line break-words text-sm text-slate-800">{incident.summary}</p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={resolved ? "Reopen with an update" : "Post an update"}
              description={
                resolved
                  ? "Only if the problem is back. Posting moves the incident out of Resolved."
                  : "Keep people in the loop. Short and plain is best — even “still working on it” helps."
              }
            />
            <CardBody>
              <PostUpdateForm id={incident.id} status={resolved ? "investigating" : incident.status} notifyCount={notifyCount} reopen={resolved} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Updates" description="Newest first. The same updates show on the Service status page." />
            <CardBody>
              <IncidentTimeline updates={updates} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  Linked tickets
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{linked.length}</span>
                </span>
              }
              description="Tickets about this problem. Their requesters get every update automatically."
            />
            <CardBody className="border-b border-slate-100">
              <LinkTicketsForm id={incident.id} />
            </CardBody>
            {linked.length === 0 ? (
              <EmptyState icon={Ticket} title="No tickets linked yet" description="When people report this problem, link their tickets here so you can update and resolve them all at once." />
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Ticket</TH>
                    <TH>Requester</TH>
                    <TH>Status</TH>
                    <TH>
                      <span className="sr-only">Actions</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {linked.map((t) => (
                    <TR key={t.id}>
                      <TD className="min-w-[14rem] max-w-md">
                        <Link href={`/desk/tickets/${t.number}`} className="font-medium text-slate-900 hover:text-primary-700">
                          <span className="font-mono text-xs text-slate-500">{ticketRef(t.number)}</span> {t.subject}
                        </Link>
                      </TD>
                      <TD>
                        <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                          <Avatar name={t.requester?.full_name ?? "?"} src={t.requester?.avatar_url} size="xs" />
                          {t.requester?.full_name ?? "—"}
                        </span>
                      </TD>
                      <TD>
                        <TicketStatusBadge status={t.status} />
                      </TD>
                      <TD className="text-right">
                        {me.agentTeamIds.includes(t.team_id) && (
                          <ActionButton
                            action={unlinkTicket}
                            fields={{ id: incident.id, ticket_id: t.id }}
                            variant="ghost"
                            confirm={`Unlink ${ticketRef(t.number)}? Its requester will stop getting incident updates.`}
                            title={`Unlink ${ticketRef(t.number)}`}
                          >
                            <Link2Off className="h-3.5 w-3.5" aria-hidden />
                            Unlink
                          </ActionButton>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Actions" />
            <CardBody className="space-y-3">
              {!resolved ? (
                <>
                  <ResolveIncidentDialog id={incident.id} openTickets={openLinked.length} notifyCount={notifyCount} />
                  <p className="text-xs text-slate-500">When it&apos;s fixed, resolve it here. You can also resolve the linked tickets in one go.</p>
                </>
              ) : (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Resolved on {formatDateTime(incident.resolved_at)}.</p>
              )}
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <EditIncidentDialog id={incident.id} title={incident.title} summary={incident.summary} severity={sev} />
                {canDelete && (
                  <ActionButton
                    action={deleteIncident}
                    fields={{ id: incident.id }}
                    variant="danger"
                    confirm={`Delete “${incident.title}”? It disappears from Service status and its ${linked.length === 1 ? "ticket is" : "tickets are"} unlinked. This can't be undone.`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Delete
                  </ActionButton>
                )}
              </div>
              {canDelete && <p className="text-xs text-slate-400">Delete only if it was declared by mistake. Otherwise resolve it, so there&apos;s a record.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Started</dt>
                  <dd className="text-right text-slate-800">{formatDateTime(incident.started_at)}</dd>
                </div>
                {resolved && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Resolved</dt>
                    <dd className="text-right text-slate-800">{formatDateTime(incident.resolved_at)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Declared by</dt>
                  <dd className="flex items-center gap-1.5 text-right text-slate-800">
                    {incident.creator?.full_name && <Avatar name={incident.creator.full_name} src={incident.creator.avatar_url} size="xs" />}
                    {incident.creator?.full_name ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-slate-500">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    Said they&apos;re affected
                  </dt>
                  <dd className="text-right font-medium text-slate-800">{peopleCount(subscriberCount)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Open linked tickets</dt>
                  <dd className="text-right font-medium text-slate-800">{openLinked.length}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Gets updates</dt>
                  <dd className="text-right font-medium text-slate-800">{peopleCount(notifyCount)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
