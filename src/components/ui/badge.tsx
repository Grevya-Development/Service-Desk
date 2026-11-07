import { cn, humanize } from "@/lib/utils";

export type Tone = "gray" | "blue" | "green" | "yellow" | "red" | "purple" | "orange" | "teal";

const tones: Record<Tone, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  yellow: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  purple: "bg-violet-50 text-violet-700 ring-violet-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
};

export function Badge({ tone = "gray", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  pending: "yellow",
  pending_approval: "yellow",
  pending_manager: "yellow",
  pending_hr: "orange",
  pending_self: "yellow",
  submitted: "blue",
  draft: "gray",
  approved: "green",
  completed: "green",
  cleared: "green",
  paid: "teal",
  published: "green",
  active: "green",
  open: "blue",
  in_progress: "purple",
  enrolled: "blue",
  resolved: "green",
  closed: "gray",
  rejected: "red",
  cancelled: "gray",
  withdrawn: "gray",
  expired: "gray",
  terminated: "red",
  exited: "gray",
  notice_period: "orange",
  on_hold: "orange",
  present: "green",
  absent: "red",
  half_day: "yellow",
  wfh: "purple",
  on_duty: "teal",
  leave: "orange",
  holiday: "blue",
  hired: "green",
  offer: "teal",
  interview: "purple",
  screening: "blue",
  applied: "gray",
  goal_setting: "blue",
  in_review: "purple",
};

/** Consistent coloured badge for any workflow status string. */
export function StatusBadge({ status, label, className }: { status: string | null | undefined; label?: string; className?: string }) {
  if (!status) return null;
  return (
    <Badge tone={STATUS_TONES[status] ?? "gray"} className={className}>
      {label ?? humanize(status)}
    </Badge>
  );
}
