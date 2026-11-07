"use client";

import { useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader, Field, FormGrid, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { ASSET_STATUSES, ASSET_TYPES } from "@/lib/constants";
import type { ActionState } from "@/lib/actions";

type Option = { id: string; label: string };

export type AssetFormValues = {
  id?: string;
  asset_tag?: string;
  name?: string;
  type?: string;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  status?: string;
  assigned_to?: string | null;
  location_id?: string | null;
  purchase_date?: string | null;
  purchase_cost?: number | null;
  vendor?: string | null;
  warranty_until?: string | null;
  notes?: string | null;
};

const CLEARS_HOLDER = ["retired", "lost"];

export function AssetForm({
  action,
  asset,
  people,
  locations,
  cancelHref,
  submitLabel,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  asset?: AssetFormValues;
  people: Option[];
  locations: Option[];
  cancelHref: string;
  submitLabel: string;
}) {
  const [status, setStatus] = useState(asset?.status ?? "in_stock");
  const [holder, setHolder] = useState(asset?.assigned_to ?? "");
  const holderKnown = !holder || people.some((p) => p.id === holder);

  const onStatus = (next: string) => {
    setStatus(next);
    // In stock / retired / lost means nobody has it.
    if (next === "in_stock" || CLEARS_HOLDER.includes(next)) setHolder("");
  };
  const onHolder = (next: string) => {
    setHolder(next);
    // Mirrors the database: giving it to someone makes it "assigned".
    if (next && next !== asset?.assigned_to) setStatus("assigned");
    if (!next && status === "assigned") setStatus("in_stock");
  };

  return (
    <ActionForm action={action} resetOnSuccess={false} className="space-y-5">
      {asset?.id && <input type="hidden" name="id" value={asset.id} />}

      <Card>
        <CardHeader title="Basics" description="How the asset is identified around the office." />
        <CardBody>
          <FormGrid>
            <Field label="Asset tag" htmlFor="asset_tag" required hint="The label stuck on the device, e.g. GRV-LT-0042. Must be unique.">
              <Input id="asset_tag" name="asset_tag" defaultValue={asset?.asset_tag} required minLength={2} maxLength={40} pattern="[\w.\/#\-]+" title="Letters, numbers and - _ . / # (no spaces)" autoComplete="off" />
            </Field>
            <Field label="Name" htmlFor="name" required hint='A friendly name, e.g. "MacBook Air 13 (2025)".'>
              <Input id="name" name="name" defaultValue={asset?.name} required minLength={2} maxLength={120} />
            </Field>
            <Field label="Type" htmlFor="type" required>
              <Select id="type" name="type" defaultValue={asset?.type ?? "laptop"} required>
                {Object.entries(ASSET_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Manufacturer" htmlFor="manufacturer">
              <Input id="manufacturer" name="manufacturer" defaultValue={asset?.manufacturer ?? ""} maxLength={80} placeholder="e.g. Apple, Dell, Lenovo" />
            </Field>
            <Field label="Model" htmlFor="model">
              <Input id="model" name="model" defaultValue={asset?.model ?? ""} maxLength={120} />
            </Field>
            <Field label="Serial number" htmlFor="serial_number">
              <Input id="serial_number" name="serial_number" defaultValue={asset?.serial_number ?? ""} maxLength={120} autoComplete="off" />
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Who has it and where" />
        <CardBody className="space-y-4">
          <FormGrid>
            <Field label="Status" htmlFor="status" required>
              <Select id="status" name="status" value={status} onChange={(e) => onStatus(e.target.value)} required>
                {Object.entries(ASSET_STATUSES).map(([k, meta]) => (
                  <option key={k} value={k}>
                    {meta.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assigned to" htmlFor="assigned_to" required={status === "assigned"}>
              <Select id="assigned_to" name="assigned_to" value={holder} onChange={(e) => onHolder(e.target.value)} required={status === "assigned"}>
                <option value="">Nobody (not assigned)</option>
                {!holderKnown && <option value={holder}>Current holder (no longer active)</option>}
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location" htmlFor="location_id">
              <Select id="location_id" name="location_id" defaultValue={asset?.location_id ?? ""}>
                <option value="">Not set</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
          <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            <span>
              Picking a person marks the asset as <strong>Assigned</strong> and lets them see it under My assets. Choosing <strong>In stock</strong>,{" "}
              <strong>Retired</strong> or <strong>Lost</strong> removes the current holder. An asset <strong>In repair</strong> can keep its holder.
            </span>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Purchase and warranty" description="Optional, but handy when something breaks." />
        <CardBody>
          <FormGrid>
            <Field label="Purchase date" htmlFor="purchase_date">
              <Input id="purchase_date" name="purchase_date" type="date" defaultValue={asset?.purchase_date ?? ""} />
            </Field>
            <Field label="Purchase cost (₹)" htmlFor="purchase_cost">
              <Input id="purchase_cost" name="purchase_cost" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={asset?.purchase_cost ?? ""} />
            </Field>
            <Field label="Vendor" htmlFor="vendor">
              <Input id="vendor" name="vendor" defaultValue={asset?.vendor ?? ""} maxLength={120} placeholder="Who we bought it from" />
            </Field>
            <Field label="Warranty until" htmlFor="warranty_until" hint="We flag warranties ending in the next 30 days.">
              <Input id="warranty_until" name="warranty_until" type="date" defaultValue={asset?.warranty_until ?? ""} />
            </Field>
            <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
              <Textarea id="notes" name="notes" defaultValue={asset?.notes ?? ""} rows={4} maxLength={4000} placeholder="Accessories, licence keys location, anything worth knowing" />
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Link href={cancelHref} className={buttonClass("ghost")}>
          Cancel
        </Link>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
