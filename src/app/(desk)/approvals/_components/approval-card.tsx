import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Check, ExternalLink, Info, X } from "lucide-react";
import { Avatar, Card } from "@/components/ui";
import { ActionButton } from "@/components/ui/action-button";
import { PriorityBadge } from "@/components/tickets/badges";
import { Markdown } from "@/components/markdown";
import { ticketRef } from "@/lib/constants";
import { cn, formatDateTime } from "@/lib/utils";
import { CatalogIcon } from "@/app/(desk)/catalog/_lib/icons";
import { answerRows, answersMarkdown, parseFields } from "@/app/(desk)/catalog/_lib/fields";
import { tint } from "@/app/(desk)/catalog/_lib/copy";
import { decideApproval } from "../actions";
import type { ApprovalWithTicket } from "../_lib/data";

/** One request waiting on the viewer, with the answers and approve / reject buttons. */
export function ApprovalCard({ approval, isOwn }: { approval: ApprovalWithTicket; isOwn: boolean }) {
  const t = approval.ticket;
  const requester = t.requester;
  const name = requester?.full_name ?? "Former employee";
  const fields = parseFields(t.catalog_item?.fields);
  const rows = answerRows(fields, t.form_data);
  // Hide the description when it's just the answers list generated on submit.
  const showDescription = t.description.trim() && t.description.trim() !== answersMarkdown(fields, t.form_data);
  const color = t.team?.color ?? approval.team?.color;
  const role = approval.kind === "manager" ? "You're their manager" : `For ${approval.team?.name ?? t.team?.name ?? "team"} leads`;
  const href = `/requests/${t.number}`;

  return (
    <Card className="overflow-hidden">
      <div aria-hidden className="h-1" style={{ backgroundColor: tint(color, 1) }} />
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={name} src={requester?.avatar_url} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
            <p className="truncate text-xs text-slate-500">{[requester?.designation, requester?.department].filter(Boolean).join(" · ") || "Employee"}</p>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p title={formatDateTime(t.created_at)}>Requested {formatDistanceToNowStrict(new Date(t.created_at), { addSuffix: true })}</p>
          <p className="mt-0.5 text-slate-400">{role}</p>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {t.catalog_item && (
              <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: tint(color, 1) }}>
                <CatalogIcon name={t.catalog_item.icon} className="h-3.5 w-3.5" />
                {t.catalog_item.name}
              </span>
            )}
            <Link href={href} className="font-mono text-slate-500 hover:text-primary-600">
              {ticketRef(t.number)}
            </Link>
            <PriorityBadge priority={t.priority} />
          </div>
          <h3 className="text-base font-semibold text-slate-900">
            <Link href={href} className="hover:text-primary-700">
              {t.subject}
            </Link>
          </h3>
        </div>

        {rows.length > 0 && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg bg-slate-50 px-4 py-3 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.key} className={cn("min-w-0", r.long && "sm:col-span-2")}>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{r.label}</dt>
                <dd className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-800">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {showDescription && (
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{rows.length ? "Note from " + (requester?.full_name?.split(" ")[0] ?? "the requester") : "Details"}</p>
            <Markdown source={t.description} className="prose-doc break-words text-sm text-slate-700" />
          </div>
        )}

        {isOwn && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            This is your own request, so another team lead needs to approve it.
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-primary-600">
          Open full request <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
        {!isOwn && (
          <div className="flex gap-2">
            <ActionButton
              action={decideApproval}
              fields={{ id: approval.id, decision: "reject" }}
              variant="outline"
              size="md"
              className="flex-1 sm:flex-none"
              confirm={`Reject ${ticketRef(t.number)}?`}
              prompt={`Why are you rejecting it? ${requester?.full_name?.split(" ")[0] ?? "The requester"} will see this.`}
              promptRequired
            >
              <X className="h-4 w-4 text-red-600" aria-hidden /> Reject
            </ActionButton>
            <ActionButton
              action={decideApproval}
              fields={{ id: approval.id, decision: "approve" }}
              variant="success"
              size="md"
              className="flex-1 sm:flex-none"
              confirm={`Approve ${ticketRef(t.number)}?`}
              prompt="Add a comment (optional)"
            >
              <Check className="h-4 w-4" aria-hidden /> Approve
            </ActionButton>
          </div>
        )}
      </div>
    </Card>
  );
}
