"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { ASSET_STATUSES, ASSET_TYPES } from "@/lib/constants";
import type { TablesInsert } from "@/lib/database.types";
import { str } from "@/lib/utils";
import { UUID_RE } from "./_lib/shared";

type AssetInsert = TablesInsert<{ schema: "servicedesk" }, "assets">;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s: string) => DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

async function assetManager() {
  const me = await getViewer();
  if (!me) return { error: "Please sign in again." } as const;
  if (!me.managesAssets) return { error: "Only the IT team can change the asset register." } as const;
  return { me } as const;
}

function friendly(error: { message: string; code?: string }) {
  if (error.code === "23505") return "That asset tag is already in use. Pick a different tag.";
  if (error.code === "23514") return "Some details aren't valid. Check the tag (2–40 characters), name (2–120 characters) and cost.";
  if (error.code === "23503") return "The person or location you picked no longer exists.";
  return dbError(error);
}

function revalidate(id?: string) {
  revalidatePath("/desk/assets");
  if (id) revalidatePath(`/desk/assets/${id}`);
  revalidatePath("/assets/mine");
}

/** Read and validate the asset form. Returns the row or an error message. */
function parseAssetForm(fd: FormData): { row: AssetInsert } | { error: string } {
  const asset_tag = str(fd, "asset_tag");
  const name = str(fd, "name");
  const type = str(fd, "type") ?? "laptop";
  const status = str(fd, "status") ?? "in_stock";
  const assigned_to = str(fd, "assigned_to");
  const location_id = str(fd, "location_id");
  const purchase_date = str(fd, "purchase_date");
  const warranty_until = str(fd, "warranty_until");
  const costRaw = str(fd, "purchase_cost");

  if (!asset_tag || asset_tag.length < 2 || asset_tag.length > 40) return { error: "Asset tag must be 2–40 characters." };
  if (!/^[\w./#-]+$/.test(asset_tag)) return { error: "Asset tag can use letters, numbers and - _ . / # only (no spaces)." };
  if (!name || name.length < 2 || name.length > 120) return { error: "Name must be 2–120 characters." };
  if (!(type in ASSET_TYPES)) return { error: "Pick a valid type." };
  if (!(status in ASSET_STATUSES)) return { error: "Pick a valid status." };
  if (assigned_to && !UUID_RE.test(assigned_to)) return { error: "Pick a person from the list." };
  if (location_id && !UUID_RE.test(location_id)) return { error: "Pick a location from the list." };
  if (status === "assigned" && !assigned_to) return { error: "Choose who has this asset, or pick a different status." };
  if (purchase_date && !isDay(purchase_date)) return { error: "Purchase date isn't a valid date." };
  if (warranty_until && !isDay(warranty_until)) return { error: "Warranty end isn't a valid date." };
  if (purchase_date && warranty_until && warranty_until < purchase_date) return { error: "Warranty can't end before the purchase date." };

  let purchase_cost: number | null = null;
  if (costRaw) {
    const n = Number(costRaw.replace(/[,₹\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n >= 1e10) return { error: "Purchase cost must be a positive amount." };
    purchase_cost = Math.round(n * 100) / 100;
  }

  const text = (key: string, max: number) => {
    const v = str(fd, key);
    return v ? v.slice(0, max) : null;
  };

  // Same rules as the database trigger, made predictable: retired / lost assets
  // have no holder; picking a person for an in-stock asset means it's assigned;
  // an asset in repair may keep its holder.
  const holder = status === "retired" || status === "lost" ? null : assigned_to;
  const finalStatus = holder && status === "in_stock" ? "assigned" : status;

  return {
    row: {
      asset_tag,
      name,
      type,
      status: finalStatus,
      assigned_to: holder,
      location_id,
      manufacturer: text("manufacturer", 80),
      model: text("model", 120),
      serial_number: text("serial_number", 120),
      purchase_date,
      purchase_cost,
      vendor: text("vendor", 120),
      warranty_until,
      notes: text("notes", 4000),
    },
  };
}

export async function createAsset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await assetManager();
  if ("error" in auth) return fail(auth.error!);
  const parsed = parseAssetForm(fd);
  if ("error" in parsed) return fail(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("assets").insert(parsed.row).select("id").single();
  if (error) return fail(friendly(error));
  revalidate(data.id);
  return ok("Asset added", `/desk/assets/${data.id}`);
}

export async function updateAsset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await assetManager();
  if ("error" in auth) return fail(auth.error!);
  const id = str(fd, "id");
  if (!id || !UUID_RE.test(id)) return fail("That asset could not be found.");
  const parsed = parseAssetForm(fd);
  if ("error" in parsed) return fail(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("assets").update(parsed.row).eq("id", id).select("id").maybeSingle();
  if (error) return fail(friendly(error));
  if (!data) return fail("That asset could not be found.");
  revalidate(id);
  return ok("Changes saved", `/desk/assets/${id}`);
}

async function patch(id: string | null, values: Partial<AssetInsert>, message: string): Promise<ActionState> {
  const auth = await assetManager();
  if ("error" in auth) return fail(auth.error!);
  if (!id || !UUID_RE.test(id)) return fail("That asset could not be found.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("assets").update(values).eq("id", id).select("id").maybeSingle();
  if (error) return fail(friendly(error));
  if (!data) return fail("That asset could not be found.");
  revalidate(id);
  return ok(message);
}

export async function assignAsset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const person = str(fd, "assigned_to");
  if (!person || !UUID_RE.test(person)) return fail("Pick who should get this asset.");
  return patch(str(fd, "id"), { assigned_to: person, status: "assigned" }, "Asset assigned");
}

export async function unassignAsset(_prev: ActionState, fd: FormData): Promise<ActionState> {
  // The database moves an "assigned" asset back to "in stock"; one in repair stays in repair.
  return patch(str(fd, "id"), { assigned_to: null }, "Holder removed");
}

export async function setAssetStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const status = str(fd, "status");
  if (status !== "in_repair" && status !== "retired" && status !== "in_stock" && status !== "lost") return fail("Pick a valid status.");
  const message = { in_repair: "Marked as in repair", retired: "Asset retired", in_stock: "Asset is back in stock", lost: "Marked as lost" }[status];
  return patch(str(fd, "id"), { status }, message);
}
