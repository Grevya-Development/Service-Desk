/**
 * Pure validation helpers for the admin area. Used by the client editors (live
 * feedback) and by the server actions (the source of truth).
 */
import { FIELD_TYPES, type CatalogField, type FieldType } from "@/lib/constants";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TEAM_KEY_RE = /^[a-z][a-z0-9_-]{1,30}$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export const TEAM_COLORS = ["#2d48c8", "#0e7490", "#047857", "#65a30d", "#b45309", "#c2410c", "#be123c", "#7c3aed", "#475569"] as const;

export const TIMEZONES = [
  { value: "Asia/Kolkata", label: "India (Asia/Kolkata)" },
  { value: "Asia/Dubai", label: "Dubai (Asia/Dubai)" },
  { value: "Asia/Singapore", label: "Singapore (Asia/Singapore)" },
  { value: "Europe/London", label: "London (Europe/London)" },
  { value: "Europe/Berlin", label: "Central Europe (Europe/Berlin)" },
  { value: "America/New_York", label: "US Eastern (America/New_York)" },
  { value: "America/Los_Angeles", label: "US Pacific (America/Los_Angeles)" },
  { value: "Australia/Sydney", label: "Sydney (Australia/Sydney)" },
  { value: "UTC", label: "UTC" },
] as const;

export const WEEKDAYS = [
  { iso: 1, short: "Mon", label: "Monday" },
  { iso: 2, short: "Tue", label: "Tuesday" },
  { iso: 3, short: "Wed", label: "Wednesday" },
  { iso: 4, short: "Thu", label: "Thursday" },
  { iso: 5, short: "Fri", label: "Friday" },
  { iso: 6, short: "Sat", label: "Saturday" },
  { iso: 7, short: "Sun", label: "Sunday" },
] as const;

/* ------------------------------------------------------------------------ */
/* SLA                                                                      */
/* ------------------------------------------------------------------------ */

/** One business day = one working day of 9 hours. */
export const BUSINESS_DAY_MINS = 540;
export const SLA_UNITS = { minutes: 1, hours: 60, days: BUSINESS_DAY_MINS } as const;
export type SlaUnit = keyof typeof SLA_UNITS;
export const SLA_LIMITS = { firstResponse: 100000, resolution: 500000 } as const;

/** Pick the friendliest unit that represents `mins` exactly. */
export function bestUnit(mins: number): { value: number; unit: SlaUnit } {
  if (mins >= BUSINESS_DAY_MINS && mins % BUSINESS_DAY_MINS === 0) return { value: mins / BUSINESS_DAY_MINS, unit: "days" };
  if (mins >= 60 && mins % 60 === 0) return { value: mins / 60, unit: "hours" };
  return { value: mins, unit: "minutes" };
}

/* ------------------------------------------------------------------------ */
/* Catalog fields                                                           */
/* ------------------------------------------------------------------------ */

export const FIELD_LIMITS = { fields: 20, label: 80, help: 200, options: 30, option: 80 } as const;

/** "Laptop model?" → "laptop_model" (always matches FIELD_KEY_RE, or "" when nothing usable). */
export function keyFromLabel(label: string) {
  let k = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "");
  k = k.slice(0, 41).replace(/_+$/, "");
  return k;
}

/** Make `base` unique among `taken` by appending _2, _3… (keeps it ≤ 41 chars). */
export function uniqueKey(base: string, taken: Set<string>) {
  const root = base || "field";
  if (!taken.has(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`;
    const k = root.slice(0, 41 - suffix.length) + suffix;
    if (!taken.has(k)) return k;
  }
  return root;
}

const isFieldType = (v: unknown): v is FieldType => typeof v === "string" && Object.hasOwn(FIELD_TYPES, v);

/**
 * Strictly validate a fields array (from JSON). Returns clean objects with only
 * known properties, so nothing unexpected is stored in the jsonb column.
 */
export function validateFields(input: unknown): { ok: true; fields: CatalogField[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "The form fields are invalid." };
  if (input.length > FIELD_LIMITS.fields) return { ok: false, error: `A form can have at most ${FIELD_LIMITS.fields} fields.` };
  const keys = new Set<string>();
  const out: CatalogField[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown> | null;
    const n = i + 1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `Field ${n} is invalid.` };
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (!label) return { ok: false, error: `Field ${n} needs a label.` };
    if (label.length > FIELD_LIMITS.label) return { ok: false, error: `Field “${label.slice(0, 30)}…” label is too long (max ${FIELD_LIMITS.label} characters).` };
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    if (!FIELD_KEY_RE.test(key)) {
      return { ok: false, error: `Field “${label}” has an invalid key. Use lowercase letters, numbers and _ (start with a letter).` };
    }
    if (keys.has(key)) return { ok: false, error: `Two fields use the key “${key}”. Each key must be unique.` };
    keys.add(key);
    if (!isFieldType(raw.type)) return { ok: false, error: `Field “${label}” has an unknown type.` };
    const help = typeof raw.help === "string" ? raw.help.trim() : "";
    if (help.length > FIELD_LIMITS.help) return { ok: false, error: `Help text for “${label}” is too long (max ${FIELD_LIMITS.help} characters).` };
    const field: CatalogField = { key, label, type: raw.type };
    if (raw.required === true) field.required = true;
    if (help) field.help = help;
    if (raw.type === "select") {
      if (!Array.isArray(raw.options)) return { ok: false, error: `Dropdown “${label}” needs at least one option.` };
      const opts: string[] = [];
      for (const o of raw.options) {
        if (typeof o !== "string") return { ok: false, error: `Dropdown “${label}” has an invalid option.` };
        const t = o.trim();
        if (!t) continue;
        if (t.length > FIELD_LIMITS.option) return { ok: false, error: `An option in “${label}” is too long (max ${FIELD_LIMITS.option} characters).` };
        if (opts.includes(t)) return { ok: false, error: `Dropdown “${label}” lists “${t}” twice.` };
        opts.push(t);
      }
      if (opts.length === 0) return { ok: false, error: `Dropdown “${label}” needs at least one option.` };
      if (opts.length > FIELD_LIMITS.options) return { ok: false, error: `Dropdown “${label}” can have at most ${FIELD_LIMITS.options} options.` };
      field.options = opts;
    }
    out.push(field);
  }
  return { ok: true, fields: out };
}

/** Read stored jsonb fields defensively (never throws). */
export function parseStoredFields(value: unknown): CatalogField[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is CatalogField => !!f && typeof f === "object" && typeof (f as CatalogField).key === "string" && typeof (f as CatalogField).label === "string" && isFieldType((f as CatalogField).type),
  );
}

/** http(s) URL without trailing slash, or null if invalid. */
export function normalizeAppUrl(v: string): string | null {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.search || u.hash || u.username || u.password) return null;
  return (u.origin + u.pathname).replace(/\/+$/, "");
}
