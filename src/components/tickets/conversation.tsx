import { ArrowRightLeft, CheckCircle2, CircleDot, Flag, GitMerge, Headset, Laptop, Lock, Paperclip, ShieldAlert, Siren, Star, Tag, UserPlus, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Markdown } from "@/components/markdown";
import { PRIORITY_META, STATUS_META, isPriority, isStatus } from "@/lib/constants";
import { cn, formatDateTime, humanize } from "@/lib/utils";
import type { AttachmentView, TimelineItem } from "@/lib/tickets/load";
import { formatBytes } from "./format";

export { formatBytes };

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
      if (e.to && e.actor?.full_name && e.to === e.actor.full_name) return `${who} took this ticket`;
      return e.to ? `${who} assigned this to ${e.to}` : `${who} unassigned ${e.from ?? "the agent"}`;
    case "priority":
      return `${who} changed priority from ${label("priority", e.from)} to ${label("priority", e.to)}`;
    case "team":
      return `${who} transferred this from ${e.from ?? "—"} to ${e.to ?? "—"}`;
    case "category":
      return `${who} changed category to ${e.to ?? "none"}`;
    case "approval":
      if (e.to === "cancelled") return `Withdrawn before approval${e.actor ? ` by ${who}` : ""}`;
      return `${e.to === "approved" ? "Approved" : e.to === "rejected" ? "Rejected" : humanize(e.to)}${e.actor ? ` by ${who}` : ""}`;
    case "csat":
      return `${who} rated the resolution ${e.to === "good" ? "👍 good" : "👎 not good"}`;
    case "sla_breach":
      return `SLA breached: ${e.to === "first_response" ? "first response" : "resolution"} overdue`;
    case "asset":
      return e.to ? `${who} linked asset ${e.to}` : `${who} removed the asset link`;
    case "follower":
      return e.to && e.to === e.actor?.full_name ? `${who} started following this` : `${who} added ${e.to ?? "a colleague"} as a follower`;
    case "follower_removed":
      return e.from && e.from === e.actor?.full_name ? `${who} stopped following this` : `${who} removed ${e.from ?? "a follower"}`;
    case "incident":
      if (e.to) return `${e.actor ? `${who} linked this` : "Linked"} to incident “${e.to}”`;
      return `${e.actor ? `${who} unlinked this` : "Unlinked"} from incident${e.from ? ` “${e.from}”` : ""}`;
    case "merged":
      return `${e.actor ? `${who} merged this` : "Merged"} into ${e.to ?? "another ticket"}`;
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
  follower: UserPlus,
  follower_removed: UserPlus,
  incident: Siren,
  merged: GitMerge,
};

/**
 * Chronological conversation: messages as bubbles, changes as compact system lines.
 * `requesterId` highlights the requester's own messages; internal notes are amber.
 */
export function Conversation({
  items,
  requesterId,
  audience,
  agentIds,
  requesterSideIds,
}: {
  items: TimelineItem[];
  requesterId: string;
  audience: "agent" | "requester";
  /** Optional: team members' ids, so followers' replies aren't labelled "Support". */
  agentIds?: string[];
  /** Optional: followers' ids (the requester's side), for views that don't know the team's agents. */
  requesterSideIds?: string[];
}) {
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
        // No author: written by the desk itself (e.g. an automatic follow-up).
        const system = !item.author;
        const mine = !system && item.author?.id === requesterId;
        const name = system ? "Service Desk" : (item.author?.full_name ?? "Former employee");
        // A follower (CC'd colleague) writes on the requester's side, not as support.
        const follower =
          !system && !mine && (Boolean(requesterSideIds?.includes(item.author!.id)) || Boolean(agentIds && !agentIds.includes(item.author!.id)));
        return (
          <li key={item.id} className="flex gap-3">
            {system ? (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600" aria-hidden>
                <Headset className="h-4 w-4" />
              </span>
            ) : (
              <Avatar name={name} src={item.author?.avatar_url} size="sm" />
            )}
            <div
              className={cn(
                "min-w-0 flex-1 rounded-xl border px-4 py-3",
                item.internal ? "border-amber-200 bg-amber-50" : system ? "border-slate-200 bg-slate-50" : mine || follower ? "border-slate-200 bg-white" : "border-primary-100 bg-primary-50/50",
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="font-semibold text-slate-800">{name}</span>
                {system && <span className="text-slate-500">Automatic message</span>}
                {item.internal && (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                    <Lock className="h-3 w-3" /> Internal note
                  </span>
                )}
                {!mine && !system && !follower && !item.internal && audience === "requester" && <span className="text-primary-600">Support</span>}
                {follower && <span className="text-slate-500">Follower</span>}
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
