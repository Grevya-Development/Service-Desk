"use server";

import { revalidatePath } from "next/cache";
import { createClient, type DeskClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str, bool } from "@/lib/utils";
import { guardLead } from "../_lib/access";
import { isUuid } from "../_lib/validate";

const PATH = "/admin/categories";

/** Look up a category and check the viewer leads its team. */
type Owned = { cat: { id: string; team_id: string; name: string; active: boolean; sort_order: number }; supabase: DeskClient };

async function loadOwned(id: string | null): Promise<Owned | { error: string }> {
  if (!isUuid(id)) return { error: "Category not found." };
  const supabase = await createClient();
  const { data: cat } = await supabase.from("categories").select("id, team_id, name, active, sort_order").eq("id", id).maybeSingle();
  if (!cat) return { error: "Category not found." };
  const g = await guardLead(cat.team_id);
  if (g.error !== undefined) return { error: g.error };
  return { cat, supabase };
}

type CategoryValues = { name: string; description: string | null; active: boolean };

function readFields(fd: FormData): { values: CategoryValues } | { error: string } {
  const name = str(fd, "name");
  if (!name || name.length < 2 || name.length > 60) return { error: "Name must be 2–60 characters." };
  const description = str(fd, "description");
  if (description && description.length > 300) return { error: "Keep the description under 300 characters." };
  return { values: { name, description, active: bool(fd, "active") } };
}

const duplicate = (name: string) => `There's already a category called “${name}” in this team.`;

export async function saveCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const read = readFields(fd);
  if ("error" in read) return fail(read.error);
  const { values } = read;
  const id = str(fd, "id");

  if (id) {
    const res = await loadOwned(id);
    if ("error" in res) return fail(res.error);
    const { error } = await res.supabase.from("categories").update(values).eq("id", id);
    if (error) return fail(error.code === "23505" ? duplicate(values.name) : dbError(error));
    revalidatePath(PATH);
    return ok("Category saved");
  }

  const teamId = str(fd, "team_id");
  const g = await guardLead(teamId);
  if (g.error !== undefined) return fail(g.error);
  const supabase = await createClient();
  const { data: last } = await supabase.from("categories").select("sort_order").eq("team_id", teamId!).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("categories").insert({ ...values, team_id: teamId!, sort_order: (last?.sort_order ?? 0) + 1 });
  if (error) return fail(error.code === "23505" ? duplicate(values.name) : dbError(error));
  revalidatePath(PATH);
  return ok("Category added");
}

export async function setCategoryActive(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await loadOwned(str(fd, "id"));
  if ("error" in res) return fail(res.error);
  const active = bool(fd, "active");
  const { error } = await res.supabase.from("categories").update({ active }).eq("id", res.cat.id);
  if (error) return fail(dbError(error));
  revalidatePath(PATH);
  return ok(active ? `“${res.cat.name}” is active again` : `“${res.cat.name}” is hidden from new tickets`);
}

/** Move a category one step up or down; renumbers the team's categories 1…n. */
export async function moveCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await loadOwned(str(fd, "id"));
  if ("error" in res) return fail(res.error);
  const dir = str(fd, "dir");
  if (dir !== "up" && dir !== "down") return fail("Unknown direction.");
  const { supabase, cat } = res;
  const { data: all, error: listErr } = await supabase.from("categories").select("id, sort_order").eq("team_id", cat.team_id).order("sort_order").order("name");
  if (listErr || !all) return fail(dbError(listErr));
  const i = all.findIndex((c) => c.id === cat.id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return ok("Already there");
  [all[i], all[j]] = [all[j], all[i]];
  const changed = all.map((c, idx) => ({ id: c.id, sort_order: idx + 1, was: c.sort_order })).filter((c) => c.sort_order !== c.was);
  const results = await Promise.all(changed.map((c) => supabase.from("categories").update({ sort_order: c.sort_order }).eq("id", c.id)));
  const failed = results.find((r) => r.error);
  if (failed?.error) return fail(dbError(failed.error));
  revalidatePath(PATH);
  return ok("Order updated");
}

export async function deleteCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await loadOwned(str(fd, "id"));
  if ("error" in res) return fail(res.error);
  const { supabase, cat } = res;
  const head = { count: "exact" as const, head: true };
  // Count with the service-role client (permission checked above) so rows the
  // lead can't see (e.g. another team's item using this category) still count.
  const admin = createAdminClient();
  const [t, a, c] = await Promise.all([
    admin.from("tickets").select("id", head).eq("category_id", cat.id),
    admin.from("kb_articles").select("id", head).eq("category_id", cat.id),
    admin.from("catalog_items").select("id", head).eq("category_id", cat.id),
  ]);
  if (t.error || a.error || c.error) return fail("Couldn't check whether this category is in use. Try again.");
  const uses = [
    t.count ? `${t.count} ticket${t.count === 1 ? "" : "s"}` : null,
    a.count ? `${a.count} article${a.count === 1 ? "" : "s"}` : null,
    c.count ? `${c.count} catalog item${c.count === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  if (uses.length) {
    return fail(`“${cat.name}” is used by ${uses.join(", ")}, so it can't be deleted. Deactivate it instead: it stays on old records but can't be picked for new ones.`);
  }
  const { error } = await supabase.from("categories").delete().eq("id", cat.id);
  if (error) return fail(dbError(error));
  revalidatePath(PATH);
  return ok("Category deleted");
}
