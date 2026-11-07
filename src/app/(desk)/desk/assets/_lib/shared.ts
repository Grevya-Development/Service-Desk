import { addDays } from "@/lib/reports/aggregate";
import { orgToday } from "@/lib/utils";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WarrantyState = "none" | "expired" | "soon" | "ok";

/** Expired (before today), soon (within 30 days) or fine. */
export function warrantyState(until: string | null, today = orgToday()): WarrantyState {
  if (!until) return "none";
  if (until < today) return "expired";
  if (until <= addDays(today, 30)) return "soon";
  return "ok";
}
