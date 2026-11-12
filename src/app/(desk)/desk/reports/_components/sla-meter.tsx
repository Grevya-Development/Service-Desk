import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { ProgressBar } from "@/components/ui";
import type { Rate } from "@/lib/reports/aggregate";
import { pctText } from "../_lib/format";

/** One SLA target as a meter: green from 90%, amber from 75%, red below. */
export function SlaMeter({ label, rate, hint }: { label: string; rate: Rate; hint: string }) {
  const p = rate.pct;
  const tone = p === null ? "bg-slate-300" : p >= 90 ? "bg-emerald-500" : p >= 75 ? "bg-amber-500" : "bg-red-500";
  const Icon = p === null ? Clock : p >= 90 ? CheckCircle2 : AlertTriangle;
  const word = p === null ? "No data" : p >= 90 ? "On target" : p >= 75 ? "Needs attention" : "Off target";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-slate-900">{pctText(p)}</p>
      </div>
      <ProgressBar value={p ?? 0} barClassName={tone} className="bg-slate-100" />
      <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {word} · {rate.total ? `${rate.met} of ${rate.total} ${hint}` : "nothing measured yet"}
      </p>
    </div>
  );
}
