"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/** Header search: ticket numbers (SD-1042 / 1042), ticket subjects and help articles. */
export function HeaderSearch({ isAgent }: { isAgent: boolean }) {
  const router = useRouter();
  return (
    <form
      role="search"
      className="relative w-full max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        name="q"
        type="search"
        placeholder={isAgent ? "Search tickets (SD-1042), people's requests or articles" : "Search help articles and your requests"}
        aria-label="Search"
        className="h-10 w-full rounded-lg border-0 bg-slate-100 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/30"
      />
    </form>
  );
}
