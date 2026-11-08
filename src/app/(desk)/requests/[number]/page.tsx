import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  GitMerge,
  Clock,
  Hourglass,
  Laptop,
  Lock,
  MessageSquareReply,
  PartyPopper,
  Plus,
  ThumbsDown,
  ThumbsUp,
  UserMinus,
  UserRound,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadTicket, type ApprovalView, type TicketDetail } from "@/lib/tickets/load";
import { Avatar, Badge, Card, CardBody, CardHeader, PageHeader, buttonClass } from "@/components/ui";
import { ApprovalBadge, PriorityBadge, TicketStatusBadge } from "@/components/tickets/badges";
import { AttachmentList, Conversation } from "@/components/tickets/conversation";
import { Composer } from "@/components/tickets/composer";
import { ActionButton } from "@/components/ui/action-button";
import { Markdown } from "@/components/markdown";
import { APPROVAL_META, ASSET_TYPES, OPEN_STATUSES, ticketRef, type CatalogField, type Status } from "@/lib/constants";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { TeamChip } from "../_components/team-chip";
import { CloseRequestButton, RatingWidget, ReopenButton } from "../_components/request-actions";
import { FollowersPanel, type FollowerView } from "../_components/followers-panel";
import { removeFollower } from "../actions";
import { requestNow } from "../_lib/query";
import { answersMarkdown, parseFields } from "../../catalog/_lib/fields";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params;
  return { title: /^\d+$/.test(number) ? ticketRef(number) : "Request" };
}

export default async function RequestPage({ params }: { params: Promise<{ number: string }> }) {
  const me = await requireViewer();
  const { number } = await params;
  const { ticket, timeline, ticketAttachments, approvals } = await loadTicket(number);

  const isRequester = ticket.requester_id === me.id;
  // Agents working this team's tickets use the agent view.
  if (!isRequester && me.agentTeamIds.includes(ticket.team_id)) redirect(`/desk/tickets/${ticket.number}`);

  const supabase = await createClient();
  const [{ data: closeSetting }, { data: followerRows }, { data: mergedTarget }] = await Promise.all([
    supabase.from("settings").select("value").eq("key", "auto_close_days").maybeSingle(),
    supabase
      .from("ticket_followers")
      .select("employee_id, created_at, person:people!employee_id(id, full_name, email, avatar_url, designation)")
      .eq("ticket_id", ticket.id)
      .order("created_at"),
    ticket.merged_into ? supabase.from("tickets").select("number").eq("id", ticket.merged_into).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const closeDays = Number(closeSetting?.value ?? 7) || 7;
  const followers = (followerRows ?? [])
    .map((f) => f.person as unknown as FollowerView | null)
    .filter((f): f is FollowerView => f !== null);
  const isFollower = !isRequester && (followerRows ?? []).some((f) => f.employee_id === me.id);
  // Followers can reply like the requester; only the requester closes, reopens or rates.
  const canReply = (isRequester || isFollower) && ticket.status !== "closed";
  const mergedRef = ticket.merged_into ? (mergedTarget ? ticketRef(mergedTarget.number) : "another request") : null;

  const status = ticket.status as Status;
  const isOpen = OPEN_STATUSES.includes(status);
  const reopenUntil = ticket.status === "resolved" && ticket.resolved_at ? new Date(Date.parse(ticket.resolved_at) + closeDays * 86400000) : null;
  const canReopen = isRequester && reopenUntil !== null && reopenUntil.getTime() > requestNow();
  const canRate = isRequester && !ticket.csat_rating && (ticket.status === "resolved" || (ticket.status === "closed" && Boolean(ticket.resolved_at)));
  const answers = formAnswers(ticket.form_data, ticket.catalog_item?.fields);
  const ref = ticketRef(ticket.number);
  // Catalog requests without a note store the answers as the description: don't show them twice.
  const description = ticket.description.trim();
  const autoDescription =
    ticket.type === "request" &&
    answers.length > 0 &&
    (description === answersMarkdown(parseFields(ticket.catalog_item?.fields), ticket.form_data).trim() ||
      description === `Requested “${ticket.catalog_item?.name ?? ""}” from the service catalog.`);
  const requesterName = ticket.requester?.full_name ?? "the requester";

  return (
    <div>
      <PageHeader
        title={ticket.subject}
        breadcrumbs={
          isRequester
            ? [{ label: "My requests", href: "/requests" }, { label: ref }]
            : isFollower
              ? [{ label: "Following", href: "/requests?tab=following" }, { label: ref }]
              : [{ label: "Approvals", href: "/approvals" }, { label: ref }]
        }
        actions={isRequester && isOpen ? <CloseRequestButton ticketId={ticket.id} /> : undefined}
      />
      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-mono text-sm font-medium text-slate-600">{ref}</span>
        <TicketStatusBadge status={ticket.status} audience="requester" />
        <ApprovalBadge status={ticket.approval_status} />
        <PriorityBadge priority={ticket.priority} />
        <TeamChip team={ticket.team} />
        <span>Raised {formatDateTime(ticket.created_at)}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {mergedRef && (
            <div role="status" className="flex flex-col gap-3 rounded-xl border border-primary-200 bg-primary-50 px-5 py-4 sm:flex-row sm:items-center">
              <GitMerge className="hidden h-5 w-5 shrink-0 text-primary-600 sm:block" aria-hidden />
              <div className="min-w-0 flex-1 text-sm text-primary-900">
                <p className="font-semibold">This request was merged into {mergedRef} — follow updates there</p>
                <p className="mt-0.5 text-primary-800">The team is handling the same problem in one place. {isRequester ? "You've been added to it, so you'll still get every update." : ""}</p>
              </div>
              {mergedTarget && (
                <Link href={`/requests/${mergedTarget.number}`} className={cn(buttonClass("primary", "sm"), "shrink-0")}>
                  Go to {mergedRef} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </div>
          )}

          {isFollower && (
            <div role="status" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-slate-700 sm:flex-row sm:items-start">
              <Users className="hidden h-5 w-5 shrink-0 text-slate-500 sm:mt-0.5 sm:block" aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">You&apos;re following this request</p>
                <p className="mt-0.5 opacity-90">
                  {requesterName} raised it. You get updates and can reply; only {ticket.requester?.full_name?.split(" ")[0] ?? "they"} can close or reopen it.
                </p>
              </div>
              <ActionButton
                action={removeFollower}
                fields={{ ticket_id: ticket.id, employee_id: me.id }}
                confirm="Stop following this request?"
                variant="outline"
                size="sm"
                className="shrink-0 self-start"
              >
                <UserMinus className="h-3.5 w-3.5" aria-hidden /> Stop following
              </ActionButton>
            </div>
          )}

          {!isRequester && !isFollower && (
            <Callout icon={Lock} tone="slate" title={ticket.joiner_id ? "You're viewing this new-joiner request as HR" : "You're viewing this as an approver"}>
              Only {requesterName}, people they&apos;ve added and the support team can reply here.
              {ticket.approval_status === "pending" && (
                <>
                  {" "}
                  <Link href="/approvals" className="font-medium text-primary-700 underline">
                    Go to your approvals
                  </Link>{" "}
                  to approve or reject it.
                </>
              )}
            </Callout>
          )}

          {isRequester && ticket.status === "pending" && (
            <Callout icon={MessageSquareReply} tone="amber" title="We're waiting on you">
              The team needs a bit more information before they can carry on. Reply below and your request goes straight back to them.{" "}
              <a href="#reply" className="font-medium text-amber-900 underline">
                Reply now
              </a>
            </Callout>
          )}

          {isRequester && ticket.status === "resolved" && (
            <Card className="overflow-hidden border-emerald-200">
              <div className="flex items-start gap-3 bg-emerald-50 px-5 py-4">
                <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-900">We think this is sorted</p>
                  <p className="mt-0.5 text-sm text-emerald-800">
                    {reopenUntil && canReopen
                      ? `If it's still not working, reopen it by ${formatDateTime(reopenUntil.toISOString())}. After that it closes automatically.`
                      : "It will close automatically soon."}
                  </p>
                </div>
              </div>
              <CardBody className="space-y-4">
                {canRate ? <RatingWidget ticketId={ticket.id} /> : <RatedNote rating={ticket.csat_rating} comment={ticket.csat_comment} />}
                {canReopen && (
                  <div className="border-t border-slate-100 pt-4">
                    <ReopenButton ticketId={ticket.id} deadline={reopenUntil ? formatDateTime(reopenUntil.toISOString()) : null} />
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {ticket.status === "closed" && !mergedRef && (
            <Card className="overflow-hidden">
              <div className="flex items-start gap-3 bg-slate-50 px-5 py-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-slate-800">
                    {ticket.approval_status === "rejected"
                      ? "This request wasn't approved and is closed"
                      : ticket.approval_status === "cancelled"
                        ? "This request was withdrawn before it was approved"
                        : "This request is closed"}
                  </p>
                  <p className="mt-0.5 text-slate-600">
                    Need more help?{" "}
                    <Link href={`/requests/new${ticket.team ? `?team=${ticket.team.key}` : ""}`} className="font-medium text-primary-700 underline">
                      Raise a new request
                    </Link>
                    {ticket.closed_at ? ` · Closed ${formatDateTime(ticket.closed_at)}` : ""}
                  </p>
                </div>
              </div>
              {isRequester && (canRate || ticket.csat_rating) && (
                <CardBody>{canRate ? <RatingWidget ticketId={ticket.id} /> : <RatedNote rating={ticket.csat_rating} comment={ticket.csat_comment} />}</CardBody>
              )}
            </Card>
          )}

          {(!autoDescription || ticketAttachments.length > 0) && (
            <Card>
              <CardHeader
                title={autoDescription ? "Attachments" : isRequester ? "What you told us" : "Request details"}
                description={`${ticket.creator && ticket.creator.id !== ticket.requester_id ? `Raised by ${ticket.creator.full_name ?? "an agent"} · ` : !isRequester ? `From ${requesterName} · ` : ""}${formatDateTime(ticket.created_at)}`}
              />
              <CardBody className="space-y-4">
                {!autoDescription && <Markdown source={ticket.description} className="prose-doc break-words text-sm text-slate-700" />}
                {ticketAttachments.length > 0 && (
                  <div>
                    {!autoDescription && <p className="mb-2 text-xs font-medium text-slate-500">Attachments</p>}
                    <AttachmentList files={ticketAttachments} />
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {answers.length > 0 && (
            <Card>
              <CardHeader
                title={ticket.catalog_item?.name ? `${ticket.catalog_item.name}: ${isRequester ? "your answers" : "form answers"}` : isRequester ? "Your answers" : "Form answers"}
              />
              <CardBody>
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {answers.map((a) => (
                    <div key={a.key} className={cn("min-w-0", a.wide && "sm:col-span-2")}>
                      <dt className="text-xs font-medium text-slate-500">{a.label}</dt>
                      <dd className={cn("mt-0.5 whitespace-pre-wrap break-words text-sm", a.empty ? "text-slate-400" : "text-slate-800")}>{a.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Conversation" description={isRequester || isFollower ? "Replies from the support team and you, plus status changes." : undefined} />
            <CardBody className="space-y-5">
              <Conversation items={timeline} requesterId={ticket.requester_id} audience="requester" requesterSideIds={followers.map((f) => f.id)} />
              {canReply && (
                <div id="reply" className="scroll-mt-24">
                  <Composer
                    ticketId={ticket.id}
                    placeholder={ticket.status === "pending" ? "Answer the team's question or add the details they asked for…" : "Add more details or reply to the team…"}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          <NextSteps ticket={ticket} approvals={approvals} isRequester={isRequester} reopenUntil={canReopen ? reopenUntil : null} mergedRef={mergedRef} />
          {approvals.length > 0 && <ApprovalsCard approvals={approvals} isRequester={isRequester} />}
          {(followers.length > 0 || (isRequester && ticket.status !== "closed")) && (
            <FollowersPanel
              ticketId={ticket.id}
              meId={me.id}
              requesterId={ticket.requester_id}
              requesterName={requesterName}
              followers={followers}
              canManage={isRequester}
              canAdd={ticket.status !== "closed"}
            />
          )}
          <DetailsCard ticket={ticket} isRequester={isRequester} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const CALLOUT_TONES = {
  amber: "border-amber-200 bg-amber-50 text-amber-900 [&_svg]:text-amber-600",
  slate: "border-slate-200 bg-slate-50 text-slate-700 [&_svg]:text-slate-500",
};

function Callout({ icon: Icon, tone, title, children }: { icon: LucideIcon; tone: keyof typeof CALLOUT_TONES; title: string; children: React.ReactNode }) {
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-xl border px-5 py-4", CALLOUT_TONES[tone])}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 opacity-90">{children}</p>
      </div>
    </div>
  );
}

function RatedNote({ rating, comment }: { rating: string | null; comment: string | null }) {
  if (!rating) return null;
  const good = rating === "good";
  return (
    <div className="flex items-start gap-2 text-sm text-slate-600">
      {good ? <ThumbsUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <ThumbsDown className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />}
      <div className="min-w-0">
        <p>Thanks for your feedback. You said you were {good ? "happy" : "not happy"} with how this was handled.</p>
        {comment && <p className="mt-1 italic text-slate-500">“{comment}”</p>}
      </div>
    </div>
  );
}

function approverLabel(a: ApprovalView, isRequester: boolean) {
  if (a.kind === "manager") {
    const who = isRequester ? "your manager" : "the requester's manager";
    return a.approver?.full_name ? `${a.approver.full_name} (${who})` : who.charAt(0).toUpperCase() + who.slice(1);
  }
  return `${a.team?.name ?? "Team"} lead`;
}

function NextSteps({
  ticket,
  approvals,
  isRequester,
  reopenUntil,
  mergedRef,
}: {
  ticket: TicketDetail;
  approvals: ApprovalView[];
  isRequester: boolean;
  reopenUntil: Date | null;
  mergedRef: string | null;
}) {
  const awaitingApproval = ticket.approval_status === "pending";
  const pendingApproval = approvals.find((a) => a.status === "pending");
  const you = isRequester ? "you" : "the requester";
  const team = ticket.team?.name ?? "The team";

  let summary: string;
  if (mergedRef) summary = `Merged into ${mergedRef}. Updates continue there.`;
  else if (awaitingApproval) summary = `Waiting for approval from ${pendingApproval ? approverLabel(pendingApproval, isRequester) : "an approver"}. Work starts once it's approved.`;
  else if (ticket.status === "new") summary = `We've got it. ${team} will pick it up soon.`;
  else if (ticket.status === "open") summary = ticket.assignee ? `${ticket.assignee.full_name ?? "An agent"} is working on it.` : `${team} is looking into it.`;
  else if (ticket.status === "pending") summary = `The team is waiting for a reply from ${you}. The clock is paused until then.`;
  else if (ticket.status === "resolved")
    summary = reopenUntil ? `Marked as fixed. It closes automatically after ${formatDate(reopenUntil.toISOString())} unless ${you} reopen${isRequester ? "" : "s"} it.` : "Marked as fixed.";
  else
    summary =
      ticket.approval_status === "rejected"
        ? "This request wasn't approved, so it's closed."
        : ticket.approval_status === "cancelled"
          ? "Withdrawn before it was approved, so it's closed."
          : "All done. This request is closed.";

  const firstReply = ticket.first_responded_at
    ? { text: `Replied ${formatDateTime(ticket.first_responded_at)}`, done: true }
    : awaitingApproval
      ? { text: "Starts after approval" }
      : !OPEN_STATUSES.includes(ticket.status as Status)
        ? { text: "—" }
        : ticket.first_response_due
          ? { text: `By ${formatDateTime(ticket.first_response_due)}` }
          : { text: "As soon as possible" };

  const fix = ticket.resolved_at
    ? { text: `Fixed ${formatDateTime(ticket.resolved_at)}`, done: true }
    : ticket.status === "closed"
      ? { text: ticket.closed_at ? `Closed ${formatDateTime(ticket.closed_at)}` : "Closed" }
      : awaitingApproval
        ? { text: "Starts after approval" }
        : ticket.status === "pending"
          ? { text: isRequester ? "Paused while we wait for you" : "Paused while we wait for the requester", paused: true }
          : ticket.resolution_due
            ? { text: `Aiming for ${formatDateTime(ticket.resolution_due)}` }
            : { text: "As soon as possible" };

  return (
    <Card>
      <CardHeader title="What happens next" />
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-700">{summary}</p>
        <ul className="space-y-3 text-sm">
          <li className="flex items-start gap-3">
            {ticket.assignee ? (
              <Avatar name={ticket.assignee.full_name} src={ticket.assignee.avatar_url} size="sm" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <UserRound className="h-4 w-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Looking after it</p>
              <p className="font-medium text-slate-800">{ticket.assignee?.full_name ?? (ticket.status === "closed" ? "Nobody was assigned" : "Waiting for an agent")}</p>
              {ticket.assignee?.designation && <p className="text-xs text-slate-500">{ticket.assignee.designation}</p>}
            </div>
          </li>
          <NextRow icon={ticket.first_responded_at ? CheckCircle2 : awaitingApproval ? Hourglass : Clock} label="First reply" {...firstReply} />
          <NextRow icon={ticket.resolved_at ? CheckCircle2 : awaitingApproval ? Hourglass : Clock} label="Expected fix" {...fix} />
        </ul>
        {!awaitingApproval && OPEN_STATUSES.includes(ticket.status as Status) && (ticket.first_response_due || ticket.resolution_due) && (
          <p className="text-[11px] leading-relaxed text-slate-400">Times are targets based on office hours (Mon–Fri) and the urgency you chose.</p>
        )}
      </CardBody>
    </Card>
  );
}

function NextRow({ icon: Icon, label, text, done, paused }: { icon: LucideIcon; label: string; text: string; done?: boolean; paused?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          done ? "bg-emerald-50 text-emerald-600" : paused ? "bg-amber-50 text-amber-600" : "bg-primary-50 text-primary-600",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className={cn("font-medium", paused ? "text-amber-800" : "text-slate-800")}>{text}</p>
      </div>
    </li>
  );
}

function ApprovalsCard({ approvals, isRequester }: { approvals: ApprovalView[]; isRequester: boolean }) {
  return (
    <Card>
      <CardHeader title="Approval" />
      <CardBody>
        <ul className="space-y-4">
          {approvals.map((a) => {
            const meta = APPROVAL_META[a.status] ?? { label: a.status, tone: "gray" as const };
            const Icon = a.status === "approved" ? CheckCircle2 : a.status === "rejected" || a.status === "cancelled" ? XCircle : Hourglass;
            return (
              <li key={a.id} className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    a.status === "approved"
                      ? "bg-emerald-50 text-emerald-600"
                      : a.status === "rejected"
                        ? "bg-red-50 text-red-600"
                        : a.status === "cancelled"
                          ? "bg-slate-100 text-slate-500"
                          : "bg-amber-50 text-amber-600",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-slate-800">{approverLabel(a, isRequester)}</p>
                  <div className="mt-1">
                    <Badge tone={meta.tone}>{a.status === "pending" ? "Waiting for a decision" : meta.label}</Badge>
                  </div>
                  {a.decided_at && (
                    <p className="mt-1 text-xs text-slate-500">
                      {a.decider?.full_name ? `${a.decider.full_name} · ` : ""}
                      {formatDateTime(a.decided_at)}
                    </p>
                  )}
                  {a.comment && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-600">“{a.comment}”</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function DetailsCard({ ticket, isRequester }: { ticket: TicketDetail; isRequester: boolean }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Reference", value: <span className="font-mono">{ticketRef(ticket.number)}</span> },
    { label: "Team", value: <TeamChip team={ticket.team} /> },
  ];
  if (ticket.category) rows.push({ label: "Topic", value: ticket.category.name });
  rows.push({ label: "Type", value: ticket.type === "request" ? (ticket.catalog_item ? `Service request · ${ticket.catalog_item.name}` : "Service request") : "Issue" });
  rows.push({ label: "Urgency", value: <PriorityBadge priority={ticket.priority} /> });
  if (!isRequester && ticket.requester) rows.push({ label: "Requested by", value: ticket.requester.full_name ?? ticket.requester.email });
  if (ticket.creator && ticket.creator.id !== ticket.requester_id) rows.push({ label: isRequester ? "Raised for you by" : "Raised by", value: ticket.creator.full_name ?? "—" });
  if (ticket.asset)
    rows.push({
      label: "Device",
      value: (
        <span className="inline-flex items-start gap-1.5">
          <Laptop className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span>
            <span className="font-mono text-xs font-medium text-slate-600">{ticket.asset.asset_tag}</span> · {ticket.asset.name}
            <span className="block text-xs text-slate-500">{ASSET_TYPES[ticket.asset.type as keyof typeof ASSET_TYPES] ?? ticket.asset.type}</span>
          </span>
        </span>
      ),
    });
  rows.push({ label: "Raised", value: formatDateTime(ticket.created_at) });
  rows.push({ label: "Last update", value: formatDateTime(ticket.updated_at) });

  return (
    <Card>
      <CardHeader title="Details" />
      <CardBody>
        <dl className="space-y-3 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-4">
              <dt className="shrink-0 text-xs text-slate-500">{r.label}</dt>
              <dd className="min-w-0 text-right text-slate-800">{r.value}</dd>
            </div>
          ))}
        </dl>
        {ticket.legacy_ref && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            Imported from HR Helpdesk {ticket.legacy_ref}
          </p>
        )}
        {isRequester && ticket.status !== "closed" && (
          <Link href="/requests/new" className={cn(buttonClass("ghost", "sm"), "mt-4 w-full")}>
            <Plus className="h-3.5 w-3.5" /> Something else? Report a new issue
          </Link>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

type Answer = { key: string; label: string; value: string; empty: boolean; wide: boolean };

/** Catalog form answers in the item's field order; unknown keys fall back to a readable label. */
function formAnswers(formData: unknown, fields: unknown): Answer[] {
  if (!formData || typeof formData !== "object" || Array.isArray(formData)) return [];
  const data = formData as Record<string, unknown>;
  const defs = (Array.isArray(fields) ? fields : []).filter(
    (f): f is CatalogField => !!f && typeof f === "object" && typeof (f as CatalogField).key === "string" && typeof (f as CatalogField).label === "string",
  );
  const out: Answer[] = [];
  const seen = new Set<string>();
  for (const f of defs) {
    seen.add(f.key);
    if (!(f.key in data)) continue;
    out.push(answer(f.key, f.label, data[f.key], f.type));
  }
  for (const [k, v] of Object.entries(data)) {
    if (seen.has(k)) continue;
    out.push(answer(k, readableKey(k), v));
  }
  return out;
}

function answer(key: string, label: string, raw: unknown, type?: string): Answer {
  const text = formatValue(raw, type);
  return { key, label, value: text ?? "Not provided", empty: text === null, wide: type === "textarea" || (text?.length ?? 0) > 60 };
}

function formatValue(v: unknown, type?: string): string | null {
  if (v === null || v === undefined || v === "") return type === "checkbox" ? "No" : null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (type === "checkbox") return ["on", "true", "1", "yes"].includes(String(v).toLowerCase()) ? "Yes" : "No";
  if (type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDate(v.slice(0, 10));
  if (Array.isArray(v)) return v.length ? v.map((x) => formatValue(x) ?? "").filter(Boolean).join(", ") : null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function readableKey(k: string) {
  const s = k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
