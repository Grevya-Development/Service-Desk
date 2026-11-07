import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Previous / next pagination. `hrefFor(page)` builds the URL for a page;
 * keep `page` as the last query parameter so URL-driven tabs stay highlighted.
 */
export function Pager({ page, pageSize, total, hrefFor, noun = "items" }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string; noun?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page <= 1) return null;
  const from = Math.min(total, (page - 1) * pageSize + 1);
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span>
        Showing {from}–{to} of {total} {noun}
      </span>
      <div className="flex items-center gap-2">
        <PagerLink href={page > 1 ? hrefFor(page - 1) : null} label="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" /> Previous
        </PagerLink>
        <span className="tabular-nums">
          Page {Math.min(page, pages)} of {pages}
        </span>
        <PagerLink href={page < pages ? hrefFor(page + 1) : null} label="Next page">
          Next <ChevronRight className="h-3.5 w-3.5" />
        </PagerLink>
      </div>
    </nav>
  );
}

function PagerLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href) {
    return (
      <span aria-disabled className={cn(buttonClass("outline", "sm"), "pointer-events-none opacity-40")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={buttonClass("outline", "sm")}>
      {children}
    </Link>
  );
}
