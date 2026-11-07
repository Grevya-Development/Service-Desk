"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type TooltipContentProps,
} from "recharts";
import { shortDay } from "../_lib/format";

/*
 * Colours follow the data-viz palette: categorical slots 1–2 (blue, orange) for
 * the two volume series, one blue hue for single-series bars, and an ordinal
 * blue ramp (light → dark, `ordinal`) where order matters (priority, backlog age).
 */
const SERIES = { created: "#2a78d6", resolved: "#eb6834" } as const;
const BAR = "#2a78d6";
const ORDINAL_RAMP = ["#86b6ef", "#5598e7", "#256abf", "#104281"];

const AXIS = { fontSize: 11, fill: "#64748b" };
const GRID = "#e2e8f0";

type Datum = { label: string; count: number };
type DayDatum = { day: string; created: number; resolved: number };


function TooltipCard({ title, rows }: { title: string; rows: { label: string; value: number; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-slate-800">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-slate-600">
          {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} aria-hidden />}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums text-slate-900">{r.value.toLocaleString("en-IN")}</span>
        </p>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; total: number }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span className="h-0.5 w-4 rounded-full" style={{ background: i.color, height: 3 }} aria-hidden />
          {i.label}
          <span className="font-semibold tabular-nums text-slate-900">{i.total.toLocaleString("en-IN")}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tickets created vs resolved per day. */
export function VolumeChart({ data }: { data: DayDatum[] }) {
  const totals = data.reduce((acc, d) => ({ created: acc.created + d.created, resolved: acc.resolved + d.resolved }), { created: 0, resolved: 0 });
  return (
    <div>
      <Legend
        items={[
          { label: "Created", color: SERIES.created, total: totals.created },
          { label: "Resolved", color: SERIES.resolved, total: totals.resolved },
        ]}
      />
      <div className="h-64" role="img" aria-label={`Line chart: ${totals.created} tickets created and ${totals.resolved} resolved over ${data.length} days`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="fill-created" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES.created} stopOpacity={0.14} />
                <stop offset="100%" stopColor={SERIES.created} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fill-resolved" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES.resolved} stopOpacity={0.1} />
                <stop offset="100%" stopColor={SERIES.resolved} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              cursor={{ stroke: "#94a3b8", strokeWidth: 1 }}
              content={({ active, payload, label }: TooltipContentProps) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={shortDay(String(label))}
                    rows={[
                      { label: "Created", value: Number(payload[0]?.payload.created ?? 0), color: SERIES.created },
                      { label: "Resolved", value: Number(payload[0]?.payload.resolved ?? 0), color: SERIES.resolved },
                    ]}
                  />
                ) : null
              }
            />
            <Area type="linear" dataKey="created" name="Created" stroke={SERIES.created} strokeWidth={2} fill="url(#fill-created)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
            <Area type="linear" dataKey="resolved" name="Resolved" stroke={SERIES.resolved} strokeWidth={2} fill="url(#fill-resolved)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Horizontal bars: good for long category names on narrow screens. */
export function HorizontalBars({ data, ordinal = false, unit = "tickets", ariaLabel }: { data: Datum[]; ordinal?: boolean; unit?: string; ariaLabel: string }) {
  const height = Math.max(120, data.length * 36 + 24);
  const fillFor = (i: number) => (ordinal ? (ORDINAL_RAMP[i] ?? BAR) : BAR);
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="label"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={136}
            tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)}
          />
          <Tooltip
            cursor={{ fill: "#f1f5f9" }}
            content={({ active, payload }: TooltipContentProps) =>
              active && payload?.length ? (
                <TooltipCard title={String(payload[0].payload.label)} rows={[{ label: unit[0].toUpperCase() + unit.slice(1), value: Number(payload[0].payload.count) }]} />
              ) : null
            }
          />
          <Bar
            dataKey="count"
            maxBarSize={22}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            label={{ position: "right", fontSize: 11, fill: "#334155" }}
            shape={(p: BarShapeProps) => <Rectangle {...p} fill={fillFor(p.index)} />}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical columns for a few ordered buckets (backlog age). */
export function Columns({ data, ordinal = false, ariaLabel }: { data: Datum[]; ordinal?: boolean; ariaLabel: string }) {
  const fillFor = (i: number) => (ordinal ? (ORDINAL_RAMP[i] ?? BAR) : BAR);
  return (
    <div className="h-56" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: -16 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            cursor={{ fill: "#f1f5f9" }}
            content={({ active, payload }: TooltipContentProps) =>
              active && payload?.length ? <TooltipCard title={String(payload[0].payload.label)} rows={[{ label: "Open tickets", value: Number(payload[0].payload.count) }]} /> : null
            }
          />
          <Bar
            dataKey="count"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            label={{ position: "top", fontSize: 11, fill: "#334155" }}
            shape={(p: BarShapeProps) => <Rectangle {...p} fill={fillFor(p.index)} />}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
