import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LeadTeam } from "../_lib/data";

/** Pill links that switch the `?team=` param. Hidden when there is only one team. */
export function TeamSwitcher({ teams, selectedId, basePath }: { teams: LeadTeam[]; selectedId: string; basePath: string }) {
  if (teams.length < 2) return null;
  return (
    <nav aria-label="Choose team" className="mb-5 flex flex-wrap gap-2">
      {teams.map((t) => {
        const active = t.id === selectedId;
        return (
          <Link
            key={t.id}
            href={`${basePath}?team=${t.id}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              active ? "border-transparent bg-white text-slate-900 shadow-sm ring-2" : "border-slate-200 bg-white/60 text-slate-600 hover:bg-white hover:text-slate-900",
              !t.active && "opacity-70",
            )}
            style={active ? ({ "--tw-ring-color": t.color } as React.CSSProperties) : undefined}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
            {t.name}
            {!t.active && <span className="text-xs font-normal text-slate-400">(inactive)</span>}
          </Link>
        );
      })}
    </nav>
  );
}
