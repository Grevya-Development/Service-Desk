"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type LinkTab = { label: string; href: string; count?: number };

/**
 * URL-driven tabs. A tab is active when its path matches and every query
 * parameter in its href is present in the current URL with the same value
 * (extra params like page/q are ignored). The most specific match wins.
 */
export function LinkTabs({ tabs, className }: { tabs: LinkTab[]; className?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  let activeHref: string | undefined;
  let best = -1;
  for (const t of tabs) {
    const [path, query = ""] = t.href.split("?");
    if (path !== pathname) continue;
    const wanted = new URLSearchParams(query);
    let ok = true;
    let n = 0;
    wanted.forEach((v, k) => {
      n++;
      if (params.get(k) !== v) ok = false;
    });
    if (ok && n > best) {
      best = n;
      activeHref = t.href;
    }
  }

  return (
    <div className={cn("mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 thin-scroll", className)}>
      {tabs.map((t) => {
        const active = t.href === activeHref;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "border-primary-600 text-primary-700" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", active ? "bg-primary-100 text-primary-700" : "bg-slate-100 text-slate-600")}>
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
