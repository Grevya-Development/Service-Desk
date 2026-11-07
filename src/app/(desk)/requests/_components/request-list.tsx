import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { ApprovalBadge, PriorityDot, TicketStatusBadge } from "@/components/tickets/badges";
import { ticketRef } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { TeamChip } from "./team-chip";
import { timeAgo } from "../_lib/query";

export type RequestListItem = {
  id: string;
  number: number;
  subject: string;
  status: string;
  priority: string;
  approval_status: string;
  updated_at: string;
  team: { name: string; color: string } | null;
  assignee: { full_name: string | null } | null;
};

/** The requester's tickets: a table on larger screens, stacked cards on phones. */
export function RequestList({ items, now }: { items: RequestListItem[]; now: number }) {
  return (
    <>
      {/* Phones */}
      <ul className="divide-y divide-slate-100 sm:hidden">
        {items.map((t) => (
          <li key={t.id}>
            <Link href={`/requests/${t.number}`} className="flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span className="font-mono font-medium text-slate-600">{ticketRef(t.number)}</span>
                  <TeamChip team={t.team} />
                </div>
                <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-900">{t.subject}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TicketStatusBadge status={t.status} audience="requester" />
                  <ApprovalBadge status={t.approval_status} />
                  <PriorityDot priority={t.priority} />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Updated {timeAgo(t.updated_at, now)}
                  {t.assignee?.full_name ? ` · with ${t.assignee.full_name}` : ""}
                </p>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      {/* Tablets and up */}
      <div className="hidden sm:block">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="w-24">Ref</TH>
              <TH>Subject</TH>
              <TH>Team</TH>
              <TH>Status</TH>
              <TH>Priority</TH>
              <TH>Assigned to</TH>
              <TH className="text-right">Last update</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((t) => (
              <TR key={t.id} className="relative">
                <TD className="whitespace-nowrap font-mono text-xs font-medium text-slate-500">{ticketRef(t.number)}</TD>
                <TD className="min-w-[16rem] max-w-md">
                  <Link href={`/requests/${t.number}`} className="font-medium text-slate-900 after:absolute after:inset-0 hover:text-primary-700">
                    <span className="line-clamp-2">{t.subject}</span>
                  </Link>
                  {t.approval_status === "pending" && <ApprovalBadge status={t.approval_status} className="mt-1" />}
                </TD>
                <TD>
                  <TeamChip team={t.team} />
                </TD>
                <TD>
                  <TicketStatusBadge status={t.status} audience="requester" />
                </TD>
                <TD>
                  <PriorityDot priority={t.priority} />
                </TD>
                <TD className="whitespace-nowrap text-sm">{t.assignee?.full_name ?? <span className="text-slate-400">Not yet</span>}</TD>
                <TD className="whitespace-nowrap text-right text-xs text-slate-500">
                  <span title={formatDateTime(t.updated_at)}>{timeAgo(t.updated_at, now)}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}
