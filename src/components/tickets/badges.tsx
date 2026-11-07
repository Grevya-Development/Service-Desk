import { AlertTriangle, CheckCircle2, Clock, PauseCircle, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { APPROVAL_META, PRIORITY_META, STATUS_META, isPriority, isStatus } from "@/lib/constants";
import type { SlaState } from "@/lib/sla";
import { cn, formatDateTime } from "@/lib/utils";

export function TicketStatusBadge({ status, audience = "agent", className }: { status: string; audience?: "agent" | "requester"; className?: string }) {
  if (!isStatus(status)) return <Badge className={className}>{status}</Badge>;
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} className={className}>
      {audience === "requester" ? meta.requesterLabel : meta.label}
    </Badge>
  );
}

export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  if (!isPriority(priority)) return null;
  const meta = PRIORITY_META[priority];
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.label}
    </Badge>
  );
}

/** Small coloured dot + label, for dense tables. */
export function PriorityDot({ priority }: { priority: string }) {
  if (!isPriority(priority)) return null;
  const color = { urgent: "bg-red-500", high: "bg-orange-500", medium: "bg-blue-500", low: "bg-slate-400" }[priority];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      {PRIORITY_META[priority].label}
    </span>
  );
}

export function ApprovalBadge({ status, className }: { status: string; className?: string }) {
  const meta = APPROVAL_META[status];
  if (!meta || status === "not_required") return null;
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.label}
    </Badge>
  );
}

const SLA_ICONS = { breached: AlertTriangle, missed: AlertTriangle, at_risk: Clock, on_track: Clock, met: CheckCircle2, paused: PauseCircle, waiting_approval: Hourglass, none: Clock };

export function SlaBadge({ state, className }: { state: SlaState; className?: string }) {
  if (state.kind === "none") return <span className={cn("text-xs text-slate-400", className)}>—</span>;
  const Icon = SLA_ICONS[state.kind];
  return (
    <span title={state.due ? `Due ${formatDateTime(state.due)}` : undefined}>
      <Badge tone={state.tone} className={cn("gap-1", className)}>
        <Icon className="h-3 w-3" />
        {state.label}
      </Badge>
    </span>
  );
}
