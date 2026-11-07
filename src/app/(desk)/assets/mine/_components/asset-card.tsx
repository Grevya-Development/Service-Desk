import Link from "next/link";
import { createElement, type ReactNode } from "react";
import { AlertTriangle, KeyRound, Laptop, Monitor, Mouse, Package, PcCase, Router, ShieldCheck, ShieldOff, Smartphone, Tablet, Wrench, type LucideIcon } from "lucide-react";
import { Badge, Card, buttonClass } from "@/components/ui";
import { ASSET_STATUSES, ASSET_TYPES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

export type MyAsset = {
  id: string;
  asset_tag: string;
  name: string;
  type: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  status: string;
  warranty_until: string | null;
};

export type WarrantyState = "expired" | "expiring" | "ok" | "none";

const TYPE_ICONS: Record<string, LucideIcon> = {
  laptop: Laptop,
  desktop: PcCase,
  monitor: Monitor,
  phone: Smartphone,
  tablet: Tablet,
  peripheral: Mouse,
  network: Router,
  software_license: KeyRound,
};

/** Warranty compared with today in India: expired, or ending within 30 days. */
export function warrantyState(until: string | null, today: string): WarrantyState {
  if (!until) return "none";
  if (until < today) return "expired";
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  return until <= soon.toISOString().slice(0, 10) ? "expiring" : "ok";
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-slate-800">{children}</dd>
    </div>
  );
}

export function AssetCard({ asset, warranty, reportHref }: { asset: MyAsset; warranty: WarrantyState; reportHref: string }) {
  const status = ASSET_STATUSES[asset.status];
  const typeLabel = ASSET_TYPES[asset.type as keyof typeof ASSET_TYPES] ?? "Other";
  const makeModel = [asset.manufacturer, asset.model].filter(Boolean).join(" ");

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
          {createElement(TYPE_ICONS[asset.type] ?? Package, { className: "h-5 w-5", "aria-hidden": true })}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900">{asset.name}</h3>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{asset.asset_tag}</p>
        </div>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
      </div>

      {asset.status === "in_repair" && (
        <p className="mx-5 mt-3 flex items-center gap-2 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-800">
          <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden /> IT is repairing this device.
        </p>
      )}

      <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 px-5 py-4">
        <Detail label="Type">{typeLabel}</Detail>
        <Detail label="Make & model">{makeModel || "—"}</Detail>
        <Detail label="Serial number">
          <span className="font-mono text-[13px]">{asset.serial_number || "—"}</span>
        </Detail>
        <Detail label="Warranty until">
          {asset.warranty_until ? (
            <span className={warranty === "expired" ? "font-medium text-red-700" : warranty === "expiring" ? "font-medium text-amber-700" : undefined}>
              {formatDate(asset.warranty_until)}
            </span>
          ) : (
            "—"
          )}
        </Detail>
      </dl>

      {(warranty === "expired" || warranty === "expiring") && (
        <p
          className={
            warranty === "expired"
              ? "mx-5 mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"
              : "mx-5 mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
          }
        >
          {warranty === "expired" ? <ShieldOff className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          {warranty === "expired" ? "The warranty has ended. Repairs may take longer." : "The warranty ends within 30 days."}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
        {warranty === "ok" ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Under warranty
          </span>
        ) : (
          <span />
        )}
        <Link href={reportHref} className={buttonClass("outline", "sm")}>
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden /> Report a problem
        </Link>
      </div>
    </Card>
  );
}
