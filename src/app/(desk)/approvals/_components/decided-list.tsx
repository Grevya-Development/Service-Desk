import Link from "next/link";
import { CheckCircle2, MessageSquareQuote, XCircle } from "lucide-react";
import { Avatar } from "@/components/ui";
import { ticketRef } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import type { ApprovalWithTicket } from "../_lib/data";

/** Approvals the viewer decided, newest first. */
export function DecidedList({ approvals }: { approvals: ApprovalWithTicket[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {approvals.map((a) => {
        const t = a.ticket;
        const approved = a.status === "approved";
        const Icon = approved ? CheckCircle2 : XCircle;
        return (
          <li key={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 gap-3">
              <Icon className={approved ? "mt-0.5 h-5 w-5 shrink-0 text-emerald-500" : "mt-0.5 h-5 w-5 shrink-0 text-red-500"} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className={approved ? "font-medium text-emerald-700" : "font-medium text-red-700"}>{approved ? "Approved" : "Rejected"}</span>
                  <span className="text-slate-400"> · </span>
                  <Link href={`/requests/${t.number}`} className="font-medium text-slate-900 hover:text-primary-700">
                    {t.subject}
                  </Link>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                  <span className="font-mono">{ticketRef(t.number)}</span>
                  {t.catalog_item && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{t.catalog_item.name}</span>
                    </>
                  )}
                </p>
                {a.comment && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-600">
                    <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                    <span className="break-words">{a.comment}</span>
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 pl-8 sm:w-56 sm:shrink-0 sm:pl-0">
              <Avatar name={t.requester?.full_name ?? "Former employee"} src={t.requester?.avatar_url} size="xs" />
              <div className="min-w-0 text-xs">
                <p className="truncate text-slate-700">{t.requester?.full_name ?? "Former employee"}</p>
                <p className="text-slate-400">{formatDateTime(a.decided_at)}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
