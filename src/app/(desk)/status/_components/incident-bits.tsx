import { Check } from "lucide-react";
import { Avatar } from "@/components/ui";
import { cn, formatDateTime, formatTime, formatDate } from "@/lib/utils";
import { INCIDENT_STATUSES, INCIDENT_STATUS_META, SEVERITY_META, isIncidentStatus, safeColor, severityOf } from "../_lib/incident";

/** Small coloured pill for a team (IT blue, HR orange, …). */
export function TeamChip({ name, color, className }: { name: string; color: string | null | undefined; className?: string }) {
  const c = safeColor(color);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", className)}
      style={{ backgroundColor: `${c}14`, color: c, ["--tw-ring-color" as string]: `${c}33` }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
      {name}
    </span>
  );
}

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  const meta = SEVERITY_META[severityOf(severity)];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", meta.badge, className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function IncidentStatusBadge({ status, className }: { status: string; className?: string }) {
  const resolved = status === "resolved";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        resolved ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-blue-50 text-blue-700 ring-blue-200",
        className,
      )}
    >
      {isIncidentStatus(status) ? INCIDENT_STATUS_META[status].label : status}
    </span>
  );
}

/** Investigating → Identified → Monitoring → Resolved, with the current step highlighted. */
export function StatusSteps({ status, className }: { status: string; className?: string }) {
  const current = Math.max(0, INCIDENT_STATUSES.indexOf(isIncidentStatus(status) ? status : "investigating"));
  const allDone = status === "resolved";
  return (
    <ol className={cn("grid grid-cols-4", className)} aria-label={`Progress: ${INCIDENT_STATUS_META[INCIDENT_STATUSES[current]].label}`}>
      {INCIDENT_STATUSES.map((s, i) => {
        const done = i < current || allDone;
        const active = i === current && !allDone;
        return (
          <li key={s} className="relative flex flex-col items-center text-center" aria-current={active ? "step" : undefined}>
            {i > 0 && (
              <span aria-hidden className={cn("absolute right-1/2 top-2.5 h-0.5 w-full -translate-y-1/2", i <= current ? (allDone ? "bg-emerald-500" : "bg-primary-500") : "bg-slate-200")} />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-10 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white",
                done ? (allDone ? "bg-emerald-500 text-white" : "bg-primary-500 text-white") : active ? "bg-primary-600 text-white" : "bg-slate-200",
              )}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} /> : active ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> : null}
            </span>
            <span className={cn("mt-1.5 text-[11px] leading-tight sm:text-xs", active ? "font-semibold text-primary-700" : done ? "text-slate-700" : "text-slate-400")}>
              {INCIDENT_STATUS_META[s].label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type TimelineUpdate = {
  id: string;
  status: string;
  body: string;
  created_at: string;
  author: { full_name: string | null; avatar_url: string | null } | null;
};

/** Updates, newest first. */
export function IncidentTimeline({ updates, className }: { updates: TimelineUpdate[]; className?: string }) {
  const sorted = [...updates].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!sorted.length) return <p className="text-sm text-slate-500">No updates yet.</p>;
  return (
    <ol className={cn("relative space-y-4", className)}>
      {sorted.map((u, i) => (
        <li key={u.id} className="relative flex gap-3">
          {i < sorted.length - 1 && <span aria-hidden className="absolute left-[11px] top-7 bottom-[-1rem] w-px bg-slate-200" />}
          <Avatar name={u.author?.full_name ?? "Service desk"} src={u.author?.avatar_url} size="xs" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <IncidentStatusBadge status={u.status} className="px-2 py-0 text-[11px]" />
              <span className="text-xs font-medium text-slate-700">{u.author?.full_name ?? "Service desk"}</span>
              <time dateTime={u.created_at} className="text-xs text-slate-400" title={formatDateTime(u.created_at)}>
                {sameIndiaDay(u.created_at) ? formatTime(u.created_at) : formatDateTime(u.created_at)}
              </time>
            </div>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{u.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function sameIndiaDay(iso: string) {
  return formatDate(iso) === formatDate(new Date());
}
