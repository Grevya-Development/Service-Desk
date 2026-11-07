import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui";
import { ASSET_STATUSES } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";
import { warrantyState } from "../_lib/shared";

export function AssetStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = ASSET_STATUSES[status];
  return (
    <Badge tone={meta?.tone ?? "gray"} className={className}>
      {meta?.label ?? status}
    </Badge>
  );
}

export { assetTypeLabel } from "./labels";

/** Warranty end date: red when expired, amber when it ends within 30 days. */
export function WarrantyDate({ until, withHint = false }: { until: string | null; withHint?: boolean }) {
  const state = warrantyState(until);
  if (state === "none") return <span className="text-slate-400">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        state === "expired" && "font-medium text-red-600",
        state === "soon" && "font-medium text-amber-700",
      )}
    >
      {state === "expired" && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
      {state === "soon" && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
      {state === "ok" && withHint && <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />}
      {formatDate(until)}
      {state === "expired" && <span className={withHint ? "" : "sr-only"}>(expired)</span>}
      {state === "soon" && <span className={withHint ? "" : "sr-only"}>(ends soon)</span>}
    </span>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const link = "inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50";
  const disabled = "inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-300";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <p>
        Showing <span className="font-medium text-slate-700">{first}</span>–<span className="font-medium text-slate-700">{last}</span> of{" "}
        <span className="font-medium text-slate-700">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={link} rel="prev">
            <ChevronLeft className="h-3.5 w-3.5" /> Previous
          </Link>
        ) : (
          <span className={disabled} aria-disabled="true">
            <ChevronLeft className="h-3.5 w-3.5" /> Previous
          </span>
        )}
        <span className="px-1">
          Page {Math.min(page, pages)} of {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={link} rel="next">
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className={disabled} aria-disabled="true">
            Next <ChevronRight className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </nav>
  );
}
