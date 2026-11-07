import type { NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSET_STATUSES } from "@/lib/constants";
import { toCsv } from "@/lib/reports/csv";
import { orgToday } from "@/lib/utils";
import { fetchAssets, fetchLocations, parseAssetFilters } from "../_lib/data";
import { assetTypeLabel } from "../_components/labels";

/** GET /desk/assets/export?…filters → CSV of the filtered register (up to 5,000 rows). */
export async function GET(request: NextRequest) {
  const me = await getViewer();
  if (!me) return new Response("Please sign in again.", { status: 401 });
  if (!me.managesAssets) return new Response("Only the IT team can export the asset register.", { status: 403 });

  const filters = parseAssetFilters(request.nextUrl.searchParams);
  const supabase = await createClient();
  const [list, locations] = await Promise.all([fetchAssets(supabase, filters, null, 5000), fetchLocations(supabase)]);
  if (list.error) return new Response(`Could not export assets: ${list.error}`, { status: 500 });
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  const csv = toCsv(
    ["Asset tag", "Name", "Type", "Status", "Assigned to", "Assignee email", "Location", "Manufacturer", "Model", "Serial number", "Purchase date", "Purchase cost (INR)", "Vendor", "Warranty until", "Notes"],
    list.rows.map((a) => [
      a.asset_tag,
      a.name,
      assetTypeLabel(a.type),
      ASSET_STATUSES[a.status]?.label ?? a.status,
      a.holder?.full_name ?? "",
      a.holder?.email ?? "",
      a.location_id ? (locationName.get(a.location_id) ?? "") : "",
      a.manufacturer,
      a.model,
      a.serial_number,
      a.purchase_date,
      a.purchase_cost,
      a.vendor,
      a.warranty_until,
      a.notes,
    ]),
  );

  // BOM so Excel opens UTF-8 (₹, names with accents) correctly.
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="assets-${orgToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
