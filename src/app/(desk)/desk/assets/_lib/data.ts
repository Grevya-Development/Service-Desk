import "server-only";
import type { DeskClient } from "@/lib/supabase/server";
import { ASSET_STATUSES, ASSET_TYPES } from "@/lib/constants";
import type { Tables } from "@/lib/database.types";
import { addDays } from "@/lib/reports/aggregate";
import { orgToday } from "@/lib/utils";
import { UUID_RE } from "./shared";

export const PAGE_SIZE = 30;

export type AssetRow = Tables<{ schema: "servicedesk" }, "assets">;
export type Holder = { id: string; full_name: string | null; email: string; avatar_url: string | null; department: string | null; designation: string | null };
export type AssetListRow = AssetRow & { holder: Holder | null };
export type Location = { id: string; name: string };
export type PersonOption = { id: string; full_name: string | null; email: string; department: string | null; designation: string | null };

export const HOLDER_SELECT = "holder:people!assigned_to(id, full_name, email, avatar_url, department, designation)";

export type AssetFilters = {
  type: string | null;
  status: string | null;
  location: string | null;
  person: string | null;
  q: string | null;
  page: number;
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | null {
  const raw = params instanceof URLSearchParams ? params.get(key) : params[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, 100) : null;
}

/** Strip characters that have meaning inside PostgREST filters / LIKE patterns. */
export function safeSearch(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/[%_*,()\\:"]/g, " ").replace(/\s+/g, " ").trim();
  return t || null;
}

export function parseAssetFilters(params: Params): AssetFilters {
  const type = read(params, "type");
  const status = read(params, "status");
  const location = read(params, "location");
  const page = Number(read(params, "page") ?? "1");
  return {
    type: type && type in ASSET_TYPES ? type : null,
    status: status && status in ASSET_STATUSES ? status : null,
    location: location === "none" || (location && UUID_RE.test(location)) ? location : null,
    person: safeSearch(read(params, "person")),
    q: safeSearch(read(params, "q")),
    page: Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1,
  };
}

/** Query string for the given filters (page omitted unless > 1). */
export function filterQuery(f: AssetFilters, overrides: Partial<AssetFilters> = {}): string {
  const merged = { ...f, ...overrides };
  const sp = new URLSearchParams();
  for (const key of ["q", "type", "status", "location", "person"] as const) {
    const v = merged[key];
    if (v) sp.set(key, v);
  }
  if (merged.page > 1) sp.set("page", String(merged.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const hasFilters = (f: AssetFilters) => Boolean(f.type || f.status || f.location || f.person || f.q);

/**
 * Assets matching the filters, with their holder. `range` is inclusive
 * (PostgREST style); pass null to fetch everything up to `cap` rows.
 */
export async function fetchAssets(
  supabase: DeskClient,
  f: AssetFilters,
  range: { from: number; to: number } | null,
  cap = 5000,
): Promise<{ rows: AssetListRow[]; count: number; error: string | null }> {
  let personIds: string[] | null = null;
  if (f.person) {
    const { data, error } = await supabase
      .from("people")
      .select("id")
      .or(`full_name.ilike.%${f.person}%,email.ilike.%${f.person}%`)
      .limit(500);
    if (error) return { rows: [], count: 0, error: error.message };
    personIds = (data ?? []).map((p) => p.id);
    if (personIds.length === 0) return { rows: [], count: 0, error: null };
  }

  const rows: AssetListRow[] = [];
  let count = 0;
  // PostgREST caps responses at 1000 rows, so fetch in chunks.
  const start = range?.from ?? 0;
  const end = range?.to ?? cap - 1;
  for (let from = start; from <= end; from += 1000) {
    const to = Math.min(end, from + 999);
    let query = supabase.from("assets").select(`*, ${HOLDER_SELECT}`, { count: from === start ? "exact" : undefined });
    if (f.type) query = query.eq("type", f.type);
    if (f.status) query = query.eq("status", f.status);
    if (f.location === "none") query = query.is("location_id", null);
    else if (f.location) query = query.eq("location_id", f.location);
    if (personIds) query = query.in("assigned_to", personIds);
    if (f.q) {
      const like = `%${f.q}%`;
      query = query.or(`asset_tag.ilike.${like},name.ilike.${like},serial_number.ilike.${like},model.ilike.${like}`);
    }
    const { data, count: c, error } = await query.order("asset_tag").range(from, to);
    if (error) return { rows: [], count: 0, error: error.message };
    if (from === start) count = c ?? 0;
    rows.push(...((data ?? []) as unknown as AssetListRow[]));
    if (!data || data.length < to - from + 1) break;
  }
  return { rows, count, error: null };
}

export async function fetchLocations(supabase: DeskClient): Promise<Location[]> {
  const { data } = await supabase.schema("public").from("locations").select("id, name").order("name");
  return data ?? [];
}

/** Active employees for "assign to" pickers. */
export async function fetchPeople(supabase: DeskClient): Promise<PersonOption[]> {
  const { data } = await supabase.from("people").select("id, full_name, email, department, designation").neq("status", "exited").order("full_name").limit(2000);
  return data ?? [];
}

/** Register-wide counts for the stat cards. */
export async function fetchAssetStats(supabase: DeskClient) {
  const today = orgToday();
  const head = { count: "exact" as const, head: true };
  const [total, assigned, inStock, inRepair, expiring] = await Promise.all([
    supabase.from("assets").select("id", head),
    supabase.from("assets").select("id", head).eq("status", "assigned"),
    supabase.from("assets").select("id", head).eq("status", "in_stock"),
    supabase.from("assets").select("id", head).eq("status", "in_repair"),
    supabase
      .from("assets")
      .select("id", head)
      .not("status", "in", "(retired,lost)")
      .gte("warranty_until", today)
      .lte("warranty_until", addDays(today, 30)),
  ]);
  return {
    total: total.count ?? 0,
    assigned: assigned.count ?? 0,
    inStock: inStock.count ?? 0,
    inRepair: inRepair.count ?? 0,
    expiring: expiring.count ?? 0,
  };
}

/** Options for <select>s: "Priya Sharma · Engineering". */
export function personOptions(people: PersonOption[]) {
  return people.map((p) => ({ id: p.id, label: [p.full_name ?? p.email, p.department].filter(Boolean).join(" · ") }));
}

export const locationOptions = (locations: Location[]) => locations.map((l) => ({ id: l.id, label: l.name }));
