"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type LinkTab = { label: string; href: string; count?: number };

/** URL-driven tabs. A tab is active when its href matches the current path + query. */
export function LinkTabs({ tabs, className }: { tabs: LinkTab[]; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const current = pathname + (search ? `?${search}` : "");
  const exact = tabs.find((t) => t.href === current);
  const activeHref = exact?.href ?? tabs.find((t) => t.href === pathname)?.href ?? tabs.find((t) => current.startsWith(t.href))?.href;

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
