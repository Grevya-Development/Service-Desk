"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input, Select } from "@/components/ui/form";
import { PriorityBadge } from "@/components/tickets/badges";
import { PRIORITY_META, type Priority } from "@/lib/constants";
import { formatTarget } from "@/lib/sla";
import { cn } from "@/lib/utils";
import { BUSINESS_DAY_MINS, SLA_LIMITS, SLA_UNITS, bestUnit, type SlaUnit } from "../../_lib/validate";
import { saveSla } from "../actions";

type Kind = "first_response" | "resolution";
type Entry = { value: string; unit: SlaUnit };
export type SlaRow = { priority: Priority; first_response_mins: number; resolution_mins: number };

const ORDER: Priority[] = ["urgent", "high", "medium", "low"];
const UNIT_LABELS: Record<SlaUnit, string> = { minutes: "minutes", hours: "hours", days: "business days" };

function toMinutes(e: Entry): number | null {
  if (e.value.trim() === "") return null;
  const n = Number(e.value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * SLA_UNITS[e.unit]);
}

function initial(mins: number): Entry {
  const b = bestUnit(mins);
  return { value: String(b.value), unit: b.unit };
}

function daysHint(mins: number) {
  if (mins < BUSINESS_DAY_MINS) return null;
  const d = mins / BUSINESS_DAY_MINS;
  return `≈ ${Number.isInteger(d) ? d : d.toFixed(1)} business day${d === 1 ? "" : "s"}`;
}

export function SlaForm({ teamId, rows }: { teamId: string; rows: SlaRow[] }) {
  const [state, setState] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.priority, { first_response: initial(r.first_response_mins), resolution: initial(r.resolution_mins) }])) as Record<
      Priority,
      Record<Kind, Entry>
    >,
  );

  const set = (p: Priority, k: Kind, patch: Partial<Entry>) => setState((s) => ({ ...s, [p]: { ...s[p], [k]: { ...s[p][k], ...patch } } }));

  const computed = ORDER.map((p) => {
    const fr = toMinutes(state[p].first_response);
    const res = toMinutes(state[p].resolution);
    let error: string | null = null;
    if (fr === null || res === null) error = "Enter both targets.";
    else if (fr > SLA_LIMITS.firstResponse) error = `First response can be at most ${formatTarget(SLA_LIMITS.firstResponse)}.`;
    else if (res > SLA_LIMITS.resolution) error = `Resolution can be at most ${formatTarget(SLA_LIMITS.resolution)}.`;
    else if (res < fr) error = "Resolution can't be shorter than first response.";
    return { p, fr, res, error };
  });
  const hasError = computed.some((c) => c.error);

  return (
    <ActionForm action={saveSla} resetOnSuccess={false}>
      <input type="hidden" name="team_id" value={teamId} />
      <div className="divide-y divide-slate-100">
        <div className="hidden grid-cols-[160px_1fr_1fr] gap-4 bg-slate-50 px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid">
          <span>Priority</span>
          <span>First response within</span>
          <span>Resolve within</span>
        </div>
        {computed.map(({ p, fr, res, error }) => (
          <div key={p} className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[160px_1fr_1fr] md:gap-4">
            <div>
              <PriorityBadge priority={p} />
              <p className="mt-1 text-xs text-slate-500">{PRIORITY_META[p].hint}</p>
            </div>
            {(["first_response", "resolution"] as const).map((k) => {
              const mins = k === "first_response" ? fr : res;
              const id = `sla-${p}-${k}`;
              const label = `${PRIORITY_META[p].label} ${k === "first_response" ? "first response" : "resolution"}`;
              return (
                <div key={k}>
                  <p className="mb-1 text-xs font-medium text-slate-600 md:hidden">{k === "first_response" ? "First response within" : "Resolve within"}</p>
                  <div className="flex gap-2">
                    <label htmlFor={id} className="sr-only">
                      {label}
                    </label>
                    <Input
                      id={id}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={state[p][k].value}
                      onChange={(e) => set(p, k, { value: e.target.value })}
                      className={cn("w-24", error && "border-red-300")}
                      aria-invalid={Boolean(error)}
                    />
                    <label htmlFor={`${id}-unit`} className="sr-only">
                      {label} unit
                    </label>
                    <Select id={`${id}-unit`} value={state[p][k].unit} onChange={(e) => set(p, k, { unit: e.target.value as SlaUnit })} className="w-40">
                      {(Object.keys(SLA_UNITS) as SlaUnit[]).map((u) => (
                        <option key={u} value={u}>
                          {UNIT_LABELS[u]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {mins ? (
                      <>
                        = <span className="font-medium text-slate-700">{formatTarget(mins)}</span> of business time
                        {daysHint(mins) && <span className="text-slate-400"> ({daysHint(mins)})</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </p>
                  <input type="hidden" name={`${p}_${k}`} value={mins ?? ""} />
                </div>
              );
            })}
            {error && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 md:col-start-2 md:col-end-4">
                <AlertCircle className="h-3.5 w-3.5" />
                {error}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
        <p className="text-xs text-slate-500">{hasError ? "Fix the highlighted rows to save." : "All four priorities are saved together."}</p>
        <SubmitButton disabled={hasError}>Save targets</SubmitButton>
      </div>
    </ActionForm>
  );
}
