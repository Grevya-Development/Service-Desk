import "server-only";
import { getViewer, type Viewer } from "@/lib/auth";
import { isUuid } from "./validate";

type Guard = { me: Viewer; error?: undefined } | { me?: undefined; error: string };

/** For server actions: the signed-in viewer if they lead `teamId` (admins lead every team). */
export async function guardLead(teamId: unknown): Promise<Guard> {
  const me = await getViewer();
  if (!me) return { error: "Please sign in again." };
  if (!isUuid(teamId)) return { error: "Pick a team." };
  if (!me.leadTeamIds.includes(teamId)) return { error: "Only this team's leads can change that." };
  return { me };
}

/** For server actions: the signed-in viewer if they are a desk admin. */
export async function guardAdmin(): Promise<Guard> {
  const me = await getViewer();
  if (!me) return { error: "Please sign in again." };
  if (!me.isAdmin) return { error: "Only desk admins can do that." };
  return { me };
}

/** Pick the team from a `?team=` param among the teams the viewer leads (first one by default). */
export function pickTeam<T extends { id: string }>(teams: T[], param: string | string[] | undefined): T | undefined {
  const id = typeof param === "string" ? param : undefined;
  return teams.find((t) => t.id === id) ?? teams[0];
}
