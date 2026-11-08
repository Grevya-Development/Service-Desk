"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { APPROVAL_KINDS, isPriority, type ApprovalKind } from "@/lib/constants";
import { str, bool } from "@/lib/utils";
import { guardLead } from "../_lib/access";
import { CATALOG_ICONS } from "../_lib/icons";
import { isUuid, validateFields } from "../_lib/validate";

const isApproval = (v: unknown): v is ApprovalKind => typeof v === "string" && Object.hasOwn(APPROVAL_KINDS, v);

function intIn(v: string | null, min: number, max: number): number | null | "invalid" {
  if (v === null) return null;
  if (!/^-?\d+$/.test(v)) return "invalid";
  const n = Number(v);
  return n < min || n > max ? "invalid" : n;
}

function revalidateCatalog(id?: string) {
  revalidatePath("/admin/catalog");
  if (id) revalidatePath(`/admin/catalog/${id}`);
  revalidatePath("/catalog", "layout");
}

export async function saveCatalogItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const teamId = str(fd, "team_id");
  const g = await guardLead(teamId);
  if (g.error !== undefined) return fail(g.error);
  const supabase = await createClient();

  if (id !== null) {
    if (!isUuid(id)) return fail("Catalog item not found.");
    const { data: existing } = await supabase.from("catalog_items").select("team_id").eq("id", id).maybeSingle();
    if (!existing) return fail("Catalog item not found.");
    if (!g.me.leadTeamIds.includes(existing.team_id)) return fail("Only this team's leads can change that.");
  }

  const name = str(fd, "name");
  if (!name || name.length < 2 || name.length > 80) return fail("Name must be 2–80 characters.");
  const description = str(fd, "description");
  if (description && description.length > 2000) return fail("Keep the description under 2,000 characters.");
  const icon = str(fd, "icon") ?? "package";
  if (!Object.hasOwn(CATALOG_ICONS, icon)) return fail("Pick an icon from the list.");
  const approval = str(fd, "approval") ?? "none";
  if (!isApproval(approval)) return fail("Pick who needs to approve.");
  const priority = str(fd, "default_priority") ?? "medium";
  if (!isPriority(priority)) return fail("Pick a default priority.");
  const expectedDays = intIn(str(fd, "expected_days"), 0, 365);
  if (expectedDays === "invalid") return fail("Expected days must be a whole number from 0 to 365.");
  const sortOrder = intIn(str(fd, "sort_order"), -9999, 9999);
  if (sortOrder === "invalid") return fail("Sort order must be a whole number.");

  const categoryId = str(fd, "category_id");
  if (categoryId !== null) {
    if (!isUuid(categoryId)) return fail("Pick a category from the list.");
    const { data: cat } = await supabase.from("categories").select("team_id").eq("id", categoryId).maybeSingle();
    if (!cat || cat.team_id !== teamId) return fail("That category belongs to another team.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(str(fd, "fields") ?? "[]");
  } catch {
    return fail("The form fields are invalid.");
  }
  const fields = validateFields(parsed);
  if (!fields.ok) return fail(fields.error);

  const row = {
    team_id: teamId!,
    category_id: categoryId,
    name,
    description,
    icon,
    approval,
    default_priority: priority,
    expected_days: expectedDays,
    active: bool(fd, "active"),
    sort_order: sortOrder ?? 0,
    fields: fields.fields,
  };

  if (id) {
    const { error } = await supabase.from("catalog_items").update(row).eq("id", id);
    if (error) return fail(dbError(error));
    revalidateCatalog(id);
    return ok("Catalog item saved", "/admin/catalog");
  }
  const { error } = await supabase.from("catalog_items").insert(row);
  if (error) return fail(dbError(error));
  revalidateCatalog();
  return ok("Catalog item created", "/admin/catalog");
}

async function loadOwnedItem(id: string | null) {
  if (!isUuid(id)) return { error: "Catalog item not found." };
  const supabase = await createClient();
  const { data: item } = await supabase.from("catalog_items").select("id, team_id, name, system_key").eq("id", id).maybeSingle();
  if (!item) return { error: "Catalog item not found." };
  const g = await guardLead(item.team_id);
  if (g.error !== undefined) return { error: g.error };
  return { item, supabase };
}

export async function setCatalogActive(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await loadOwnedItem(str(fd, "id"));
  if (!res.item) return fail(res.error ?? "Catalog item not found.");
  const active = bool(fd, "active");
  const { error } = await res.supabase.from("catalog_items").update({ active }).eq("id", res.item.id);
  if (error) return fail(dbError(error));
  revalidateCatalog(res.item.id);
  if (res.item.system_key && !active) {
    return ok(`“${res.item.name}” is hidden. People Success won't open IT setup requests for new joiners until you show it again.`);
  }
  return ok(active ? `“${res.item.name}” is back in the catalog` : `“${res.item.name}” is hidden from the catalog`);
}

export async function deleteCatalogItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await loadOwnedItem(str(fd, "id"));
  if (!res.item) return fail(res.error ?? "Catalog item not found.");
  const { supabase, item } = res;
  if (item.system_key) return fail(`“${item.name}” is used by People Success for new joiners, so it can't be deleted. Hide it instead.`);
  // Count with the service-role client (permission checked above) so tickets
  // since transferred to another team still count.
  const { count, error: countErr } = await createAdminClient().from("tickets").select("id", { count: "exact", head: true }).eq("catalog_item_id", item.id);
  if (countErr) return fail("Couldn't check whether this item has requests. Try again.");
  if (count) {
    const { error } = await supabase.from("catalog_items").update({ active: false }).eq("id", item.id);
    if (error) return fail(dbError(error));
    revalidateCatalog(item.id);
    return ok(`“${item.name}” has ${count} request${count === 1 ? "" : "s"}, so it was deactivated instead of deleted. Past requests keep their details.`);
  }
  const { error } = await supabase.from("catalog_items").delete().eq("id", item.id);
  if (error) return fail(dbError(error));
  revalidateCatalog();
  return ok("Catalog item deleted", "/admin/catalog");
}
