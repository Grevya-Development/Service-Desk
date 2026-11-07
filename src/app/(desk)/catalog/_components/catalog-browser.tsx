"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageSquarePlus, Search, SearchX, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CatalogCard, type CatalogCardItem } from "./catalog-card";
import { tint } from "../_lib/copy";

export type CatalogTeam = { id: string; key: string; name: string; color: string; description: string | null };

const OTHER = "Other services";

/** Search + team filter over the catalog, grouped by team then category. */
export function CatalogBrowser({ teams, items, initialQuery = "", initialTeam = "" }: { teams: CatalogTeam[]; items: CatalogCardItem[]; initialQuery?: string; initialTeam?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [team, setTeam] = useState(teams.some((t) => t.key === initialTeam) ? initialTeam : "");

  const groups = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (i: CatalogCardItem) => {
      if (team && i.teamKey !== team) return false;
      if (!words.length) return true;
      const hay = `${i.name} ${i.description ?? ""} ${i.categoryName ?? ""} ${i.teamName}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    return teams
      .map((t) => {
        const byCategory = new Map<string, CatalogCardItem[]>();
        for (const i of items) {
          if (i.teamId !== t.id || !matches(i)) continue;
          const cat = i.categoryName ?? OTHER;
          byCategory.set(cat, [...(byCategory.get(cat) ?? []), i]);
        }
        // Items arrive in category order; keep "Other services" last.
        const categories = [...byCategory.entries()].sort(([a], [b]) => Number(a === OTHER) - Number(b === OTHER));
        return { team: t, categories, count: categories.reduce((n, [, list]) => n + list.length, 0) };
      })
      .filter((g) => g.count > 0);
  }, [teams, items, query, team]);

  const total = groups.reduce((n, g) => n + g.count, 0);
  const filtered = Boolean(query.trim() || team);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <label htmlFor="catalog-search" className="sr-only">
            Search services
          </label>
          <input
            id="catalog-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search, e.g. laptop, access, letter"
            autoComplete="off"
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {teams.length > 1 && (
          <div role="group" aria-label="Filter by team" className="flex flex-wrap gap-1.5">
            <TeamPill active={!team} onClick={() => setTeam("")} label="All teams" />
            {teams.map((t) => (
              <TeamPill key={t.id} active={team === t.key} onClick={() => setTeam(team === t.key ? "" : t.key)} label={t.name} color={t.color} />
            ))}
          </div>
        )}
      </div>

      {filtered && (
        <p className="mb-4 text-xs text-slate-500" aria-live="polite">
          {total === 0 ? "No matching services" : `${total} service${total === 1 ? "" : "s"} found`}
        </p>
      )}

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white">
          <EmptyState
            icon={SearchX}
            title={query.trim() ? `Nothing matches “${query.trim()}”` : "No services here yet"}
            description="Try a different word, or just tell us what you need and we'll route it to the right team."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className={buttonClass("outline")}
                  onClick={() => {
                    setQuery("");
                    setTeam("");
                  }}
                >
                  Show all services
                </button>
                <Link href="/requests/new" className={buttonClass("primary")}>
                  <MessageSquarePlus className="h-4 w-4" /> Describe what you need
                </Link>
              </div>
            }
          />
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map(({ team: t, categories }) => (
            <section key={t.id} aria-labelledby={`team-${t.id}`}>
              <div className="mb-4 flex items-center gap-3">
                <span aria-hidden className="h-6 w-1.5 rounded-full" style={{ backgroundColor: tint(t.color, 1) }} />
                <div className="min-w-0">
                  <h2 id={`team-${t.id}`} className="text-base font-semibold text-slate-900">
                    {t.name}
                  </h2>
                  {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                </div>
              </div>
              <div className="space-y-6">
                {categories.map(([category, list]) => (
                  <div key={category}>
                    {(categories.length > 1 || category !== OTHER) && (
                      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{category}</h3>
                    )}
                    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {list.map((i) => (
                        <li key={i.id}>
                          <CatalogCard item={i} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamPill({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        active ? "border-primary-600 bg-primary-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      {color && <span aria-hidden className="h-2 w-2 rounded-full ring-1 ring-white/60" style={{ backgroundColor: tint(color, 1) }} />}
      {label}
    </button>
  );
}
