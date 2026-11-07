"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { markAllNotificationsRead, markNotificationRead } from "@/app/(desk)/_actions";
import { cn, formatDateTime } from "@/lib/utils";

export type NotificationRow = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

/** Only follow in-app links ("/requests/1042"), never protocol-relative or external ones. */
const safeLink = (link: string | null) => (link && link.startsWith("/") && !link.startsWith("//") ? link : null);

export function NotificationList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Optimistically show items as read once clicked.
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

  const open = (n: NotificationRow) => {
    const link = safeLink(n.link);
    setBusyId(n.id);
    setReadIds((s) => new Set(s).add(n.id));
    startTransition(async () => {
      try {
        if (!n.read_at) await markNotificationRead(n.id);
      } catch {
        // Marking as read is best-effort; still take the user where they wanted to go.
      }
      if (link) router.push(link);
      else router.refresh();
      setBusyId(null);
    });
  };

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((n) => {
        const unread = !n.read_at && !readIds.has(n.id);
        const hasLink = Boolean(safeLink(n.link));
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => open(n)}
              disabled={pending && busyId === n.id}
              className={cn(
                "flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none",
                unread && "bg-primary-50/50 hover:bg-primary-50",
              )}
            >
              <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", unread ? "bg-primary-600" : "bg-slate-200")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", unread ? "font-semibold text-slate-900" : "font-medium text-slate-700")}>
                  {n.title}
                  {unread && <span className="sr-only"> (unread)</span>}
                </span>
                {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-slate-500">{n.body}</span>}
                <span className="mt-1 block text-xs text-slate-400">{formatDateTime(n.created_at)}</span>
              </span>
              {pending && busyId === n.id ? (
                <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden />
              ) : (
                hasLink && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" aria-hidden />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await markAllNotificationsRead();
            toast.success("All notifications marked as read");
            router.refresh();
          } catch {
            toast.error("Couldn't mark them as read. Please try again.");
          }
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
      Mark all read
    </Button>
  );
}
