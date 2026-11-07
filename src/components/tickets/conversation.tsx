import { ArrowRightLeft, CheckCircle2, CircleDot, Flag, Lock, Paperclip, ShieldAlert, Star, Tag, UserRound, Laptop } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Markdown } from "@/components/markdown";
import { PRIORITY_META, STATUS_META, isPriority, isStatus } from "@/lib/constants";
import { cn, formatDateTime, humanize } from "@/lib/utils";
import type { AttachmentView, TimelineItem } from "@/lib/tickets/load";

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentList({ files, className }: { files: AttachmentView[]; className?: string }) {
  if (!files.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {files.map((f) => (
        <li key={f.id}>
          {f.url ? (
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:border-primary-500 hover:text-primary-600"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-slate-400">{formatBytes(f.size)}</span>
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-400">
              <Paperclip className="h-3.5 w-3.5" /> {f.name} (unavailable)
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

const label = (kind: string, v: string | null) => {
  if (!v) return "none";
  if (kind === "status" && isStatus(v)) return STATUS_META[v].label;
  if (kind === "priority" && isPriority(v)) return PRIORITY_META[v].label;
  return humanize(v);
};

function eventText(e: Extract<TimelineItem, { kind: "event" }>, audience: "agent" | "requester") {
  const who = e.actor?.full_name ?? "System";
  switch (e.event) {
    case "status":
      if (audience === "requester" && isStatus(e.to)) return `${who} changed the status to ${STATUS_META[e.to].requesterLabel.toLowerCase()}`;
      return `${who} changed status from ${label("status", e.from)} to ${label("status", e.to)}`;
    case "assignee":
      return e.to ? `${who} assigned this to ${e.to}` : `${who} unassigned ${e.from ?? "the agent"}`;
    case "priority":
      return `${who} changed priority from ${label("priority", e.from)} to ${label("priority", e.to)}`;
    case "team":
      return `${who} transferred this from ${e.from ?? "—"} to ${e.to ?? "—"}`;
    case "category":
      return `${who} changed category to ${e.to ?? "none"}`;
    case "approval":
      return `${e.to === "approved" ? "Approved" : e.to === "rejected" ? "Rejected" : humanize(e.to)}${e.actor ? ` by ${who}` : ""}`;
    case "csat":
      return `${who} rated the resolution ${e.to === "good" ? "👍 good" : "👎 not good"}`;
    case "sla_breach":
      return `SLA breached: ${e.to === "first_response" ? "first response" : "resolution"} overdue`;
    case "asset":
      return e.to ? `${who} linked asset ${e.to}` : `${who} removed the asset link`;
    default:
      return `${who}: ${humanize(e.event)}`;
  }
}

const EVENT_ICONS: Record<string, typeof CircleDot> = {
  status: CheckCircle2,
  assignee: UserRound,
  priority: Flag,
  team: ArrowRightLeft,
  category: Tag,
  approval: CheckCircle2,
  csat: Star,
  sla_breach: ShieldAlert,
  asset: Laptop,
};

/**
 * Chronological conversation: messages as bubbles, changes as compact system lines.
 * `requesterId` highlights the requester's own messages; internal notes are amber.
 */
export function Conversation({ items, requesterId, audience }: { items: TimelineItem[]; requesterId: string; audience: "agent" | "requester" }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-slate-400">No replies yet.</p>;
  return (
    <ol className="space-y-4">
      {items.map((item) => {
        if (item.kind === "event") {
          if (audience === "requester" && ["category", "sla_breach"].includes(item.event)) return null;
          const Icon = EVENT_ICONS[item.event] ?? CircleDot;
          return (
            <li key={item.id} className={cn("flex items-center gap-2 pl-2 text-xs", item.event === "sla_breach" ? "text-red-600" : "text-slate-500")}>
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{eventText(item, audience)}</span>
              <span className="text-slate-400">· {formatDateTime(item.at)}</span>
            </li>
          );
        }
        const mine = item.author?.id === requesterId;
        return (
          <li key={item.id} className="flex gap-3">
            <Avatar name={item.author?.full_name ?? "Former employee"} src={item.author?.avatar_url} size="sm" />
            <div
              className={cn(
                "min-w-0 flex-1 rounded-xl border px-4 py-3",
                item.internal ? "border-amber-200 bg-amber-50" : mine ? "border-slate-200 bg-white" : "border-primary-100 bg-primary-50/50",
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="font-semibold text-slate-800">{item.author?.full_name ?? "Former employee"}</span>
                {item.internal && (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                    <Lock className="h-3 w-3" /> Internal note
                  </span>
                )}
                {!mine && !item.internal && audience === "requester" && <span className="text-primary-600">Support</span>}
                <span className="text-slate-400">{formatDateTime(item.at)}</span>
              </div>
              <Markdown source={item.body} className="prose-doc break-words text-sm text-slate-700" />
              <AttachmentList files={item.attachments} className="mt-2" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
