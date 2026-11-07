import { FIELD_TYPES, type CatalogField, type FieldType } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

/** Max characters per answer, by field type. */
export const MAX_TEXT = 500;
export const MAX_TEXTAREA = 5000;
export const MAX_NOTE = 5000;
export const MAX_DESCRIPTION = 20000;

/** Form input name for a catalog field (prefixed so it can't clash with fixed inputs). */
export const fieldInputName = (key: string) => `f_${key}`;

const isFieldType = (v: unknown): v is FieldType => typeof v === "string" && v in FIELD_TYPES;

/**
 * Catalog item `fields` come from jsonb, so read them defensively: drop
 * malformed entries and duplicate keys rather than crash the form.
 */
export function parseFields(raw: unknown): CatalogField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CatalogField[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key.trim() : "";
    if (!key || seen.has(key) || !isFieldType(r.type)) continue;
    seen.add(key);
    const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string" && o.trim() !== "").map((o) => o.trim()) : undefined;
    out.push({
      key,
      label: typeof r.label === "string" && r.label.trim() ? r.label.trim() : key,
      type: r.type,
      required: r.required === true,
      options: options?.length ? options : undefined,
      help: typeof r.help === "string" && r.help.trim() ? r.help.trim() : undefined,
    });
  }
  return out;
}

export type Answer = string | number | boolean;
export type Answers = Record<string, Answer>;

/** Valid calendar date in yyyy-mm-dd form. */
export function isIsoDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validate the submitted answers against the item's field definitions.
 * Returns the cleaned answers (empty optional answers are left out) or the
 * first error, phrased for the person filling in the form.
 */
export function readAnswers(fields: CatalogField[], fd: FormData): { answers: Answers } | { error: string } {
  const answers: Answers = {};
  for (const f of fields) {
    const name = fieldInputName(f.key);
    if (f.type === "checkbox") {
      const v = fd.get(name);
      const checked = v === "on" || v === "true" || v === "1";
      if (f.required && !checked) return { error: `Please tick “${f.label}”` };
      answers[f.key] = checked;
      continue;
    }
    const raw = fd.get(name);
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v) {
      if (f.required) return { error: `“${f.label}” is required` };
      continue;
    }
    switch (f.type) {
      case "text":
        if (v.length > MAX_TEXT) return { error: `“${f.label}” must be ${MAX_TEXT} characters or less` };
        answers[f.key] = v;
        break;
      case "textarea":
        if (v.length > MAX_TEXTAREA) return { error: `“${f.label}” must be ${MAX_TEXTAREA} characters or less` };
        answers[f.key] = v;
        break;
      case "number": {
        const n = Number(v);
        if (!Number.isFinite(n)) return { error: `“${f.label}” must be a number` };
        answers[f.key] = n;
        break;
      }
      case "date":
        if (!isIsoDate(v)) return { error: `“${f.label}” must be a valid date` };
        answers[f.key] = v;
        break;
      case "select":
        if (f.options?.length) {
          if (!f.options.includes(v)) return { error: `Choose one of the options for “${f.label}”` };
        } else if (v.length > MAX_TEXT) {
          return { error: `“${f.label}” must be ${MAX_TEXT} characters or less` };
        }
        answers[f.key] = v;
        break;
    }
  }
  return { answers };
}

/** Human-readable answer (Yes/No, formatted dates, "—" when empty). */
export function formatAnswer(field: Pick<CatalogField, "type"> | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field?.type === "date" && typeof value === "string" && isIsoDate(value)) return formatDate(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Rows to display for stored form data: the item's fields in order, then any
 * answers whose field has since been removed (labelled by their key).
 */
export function answerRows(fields: CatalogField[], formData: unknown): { key: string; label: string; value: string; long: boolean }[] {
  const data = formData && typeof formData === "object" && !Array.isArray(formData) ? (formData as Record<string, unknown>) : {};
  const rows = fields
    .filter((f) => f.key in data)
    .map((f) => ({ key: f.key, label: f.label, value: formatAnswer(f, data[f.key]), long: f.type === "textarea" }));
  const known = new Set(fields.map((f) => f.key));
  for (const [key, v] of Object.entries(data)) {
    if (!known.has(key)) rows.push({ key, label: key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), value: formatAnswer(undefined, v), long: false });
  }
  return rows;
}

/** "- **Label:** value" list, used as the ticket description when the requester adds no note. */
export function answersMarkdown(fields: CatalogField[], answers: unknown): string {
  return answerRows(fields, answers)
    .map((r) => `- **${r.label.replace(/\*/g, "")}:** ${r.value.replace(/\s*\n\s*/g, " ")}`)
    .join("\n");
}
