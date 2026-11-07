/** Short plain-language hints shared by the catalog list and the request form. */

export function approvalHint(approval: string): string | null {
  if (approval === "manager") return "Needs approval from your manager";
  if (approval === "team_lead") return "Needs approval from a team lead";
  return null;
}

export function expectedDaysHint(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  if (days === 0) return "Usually done the same day";
  return `Usually done in ${days} day${days === 1 ? "" : "s"}`;
}

/** Hex team colour with alpha, for soft tinted backgrounds (falls back to primary). */
export function tint(color: string | null | undefined, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.test(color ?? "") ? color! : "#2d48c8";
  return `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
