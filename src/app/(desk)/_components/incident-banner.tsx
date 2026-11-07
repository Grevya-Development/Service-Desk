import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, CircleAlert } from "lucide-react";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDateTime } from "@/lib/utils";
import { IncidentToggle } from "./incident-toggle";

const STATUS_LABEL: Record<string, string> = {
  investigating: "Investigating",
  identified: "Cause found",
  monitoring: "Fix applied, monitoring",
};

const SEVERITY = {
  major: { box: "border-red-200 bg-red-50", icon: "text-red-600", badge: "bg-red-600 text-white", label: "Major outage", Icon: AlertTriangle },
  minor: { box: "border-amber-200 bg-amber-50", icon: "text-amber-600", badge: "bg-amber-500 text-white", label: "Partial issue", Icon: CircleAlert },
} as const;

type Row = {
  id: string;
  title: string;
  summary: string;
  status: string;
  severity: string;
  started_at: string;
  team: { name: string } | null;
  updates: { body: string; created_at: string }[] | null;
};

/**
 * Known problems right now (newest first, up to 3), so people don't raise
 * duplicate tickets. Renders nothing when everything is working.
 */
export async function IncidentBanner({ className }: { className?: string }) {
  const me = await getViewer();
  if (!me) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incidents")
    .select("id, title, summary, status, severity, started_at, team:teams(name), updates:incident_updates(body, created_at)")
    .neq("status", "resolved")
    .order("started_at", { ascending: false })
    .order("created_at", { ascending: false, referencedTable: "incident_updates" })
    .limit(1, { referencedTable: "incident_updates" })
    .limit(3);
  const incidents = (data ?? []) as unknown as Row[];
  if (error || !incidents.length) return null;

  const { data: subs } = await supabase
    .from("incident_subscribers")
    .select("incident_id")
    .eq("employee_id", me.id)
    .in(
      "incident_id",
      incidents.map((i) => i.id),
    );
  const subscribed = new Set((subs ?? []).map((s) => s.incident_id));

  return (
    <section aria-label="Known problems right now" className={cn("space-y-2", className)}>
      {incidents.map((i) => {
        const sev = SEVERITY[i.severity === "minor" ? "minor" : "major"];
        const latest = i.updates?.[0];
        return (
          <div key={i.id} role="status" className={cn("flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-start", sev.box)}>
            <sev.Icon className={cn("hidden h-5 w-5 shrink-0 sm:mt-0.5 sm:block", sev.icon)} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", sev.badge)}>{sev.label}</span>
                <p className="text-sm font-semibold text-slate-900">{i.title}</p>
              </div>
              <p className="mt-1 line-clamp-2 break-words text-sm text-slate-700">{latest?.body ?? i.summary}</p>
              <p className="mt-1 text-xs text-slate-500">
                {STATUS_LABEL[i.status] ?? "Investigating"}
                {i.team ? ` · ${i.team.name}` : ""} · Updated {formatDateTime(latest?.created_at ?? i.started_at)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
              <IncidentToggle incidentId={i.id} initial={subscribed.has(i.id)} title={i.title} />
              <Link href="/status" className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
                <Activity className="h-3.5 w-3.5" aria-hidden /> Service status <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </div>
          </div>
        );
      })}
    </section>
  );
}
