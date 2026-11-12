import "server-only";
import { cookies } from "next/headers";
import type { Viewer } from "@/lib/auth";

/**
 * Desk admins work in the admin console by default: the sidebar shows only console pages and /home
 * opens the overview. They can switch to "my requests" (the help center everyone else sees) to raise
 * or follow their own tickets. The choice is remembered in this cookie; nobody else has a mode.
 */
export const DESK_MODE_COOKIE = "sd_mode";
export type DeskMode = "admin" | "self";

export async function getDeskMode(viewer: Pick<Viewer, "isAdmin">): Promise<DeskMode> {
  if (!viewer.isAdmin) return "self";
  const store = await cookies();
  return store.get(DESK_MODE_COOKIE)?.value === "self" ? "self" : "admin";
}
