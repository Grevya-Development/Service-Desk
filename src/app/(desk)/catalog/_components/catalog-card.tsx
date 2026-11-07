import Link from "next/link";
import { ChevronRight, Clock, ShieldCheck } from "lucide-react";
import { CatalogIcon } from "../_lib/icons";
import { approvalHint, expectedDaysHint, tint } from "../_lib/copy";

export type CatalogCardItem = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  approval: string;
  expectedDays: number | null;
  teamId: string;
  teamKey: string;
  teamName: string;
  teamColor: string;
  categoryName: string | null;
};

export function CatalogCard({ item }: { item: CatalogCardItem }) {
  const approval = approvalHint(item.approval);
  const days = expectedDaysHint(item.expectedDays);
  return (
    <Link
      href={`/catalog/${item.id}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white p-4 pt-5 shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: tint(item.teamColor, 1) }} />
      <div className="flex flex-1 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: tint(item.teamColor, 0.1), color: tint(item.teamColor, 1) }}>
          <CatalogIcon name={item.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 group-hover:text-primary-700">{item.name}</h3>
          {item.description ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{item.description}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-400">Fill in a short form and we&apos;ll take care of it.</p>
          )}
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary-500" aria-hidden />
      </div>
      {(approval || days) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          {approval && (
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              {approval}
            </span>
          )}
          {days && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              {days}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
