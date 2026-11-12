import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type BreakdownRow = { key: string; label: string; count: number; color?: string; href?: string; hint?: string };

/**
 * Bar list: each row is a label, a count and a bar scaled to the biggest row. Rows with an href are
 * links (to the filtered queue / register), so every number on the overview can be opened.
 * Plain HTML, so it reads well on phones and to screen readers.
 */
export function BreakdownList({ rows, unit = "tickets", total }: { rows: BreakdownRow[]; unit?: string; total?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const sum = total ?? rows.reduce((n, r) => n + r.count, 0);
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const pct = sum ? Math.round((r.count / sum) * 100) : 0;
        const inner = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
                {r.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />}
                <span className="truncate">{r.label}</span>
                {r.hint && <span className="hidden truncate text-xs text-slate-400 sm:inline">{r.hint}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums">
                <span className="font-semibold text-slate-900">{r.count.toLocaleString("en-IN")}</span>
                <span className="w-10 text-right text-xs text-slate-400">{pct}%</span>
                {r.href && <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-primary-500" aria-hidden />}
              </span>
            </span>
            <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <span
                className="block h-full rounded-full"
                style={{ width: `${r.count ? Math.max(2, (r.count / max) * 100) : 0}%`, backgroundColor: r.color ?? "#2a78d6" }}
              />
            </span>
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} title={`Open ${r.label} (${r.count} ${unit})`} className="group block rounded-lg px-2 py-2 hover:bg-slate-50">
                {inner}
              </Link>
            ) : (
              <div className="px-2 py-2">
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
