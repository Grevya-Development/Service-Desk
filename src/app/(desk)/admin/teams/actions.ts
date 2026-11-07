"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str, bool } from "@/lib/utils";
import { guardAdmin, guardLead } from "../_lib/access";
import { TEAM_ICONS } from "../_lib/icons";
import { HEX_RE, TEAM_KEY_RE, isUuid } from "../_lib/validate";

const DEFAULT_SLA = [
  { priority: "urgent", first_response_mins: 30, resolution_mins: 240 },
  { priority: "high", first_response_mins: 60, resolution_mins: 480 },
  { priority: "medium", first_response_mins: 240, resolution_mins: 1440 },
  { priority: "low", first_response_mins: 480, resolution_mins: 2400 },
];

function readCommon(fd: FormData): { error: string } | { description: string | null; color: string; icon: string; auto_assign: boolean } {
  const description = str(fd, "description");
  if (description && description.length > 300) return { error: "Keep the description under 300 characters." };
  const color = str(fd, "color") ?? "";
  if (!HEX_RE.test(color)) return { error: "Colour must look like #2d48c8." };
  const icon = str(fd, "icon") ?? "life-buoy";
  if (!Object.hasOwn(TEAM_ICONS, icon)) return { error: "Pick an icon from the list." };
  return { description, color: color.toLowerCase(), icon, auto_assign: bool(fd, "auto_assign") };
}

function readName(fd: FormData): string | { error: string } {
  const name = str(fd, "name");
  if (!name || name.length < 2 || name.length > 60) return { error: "Team name must be 2–60 characters." };
  return name;
}

export async function createTeam(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guardAdmin();
  if (g.error !== undefined) return fail(g.error);

  const key = (str(fd, "key") ?? "").toLowerCase();
  if (!TEAM_KEY_RE.test(key)) return fail("Short code must start with a letter and use 2–31 lowercase letters, numbers, - or _.");
  const name = readName(fd);
  if (typeof name !== "string") return fail(name.error);
  const common = readCommon(fd);
  if ("error" in common) return fail(common.error);

  const supabase = await createClient();
  const { data: last } = await supabase.from("teams").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data: team, error } = await supabase
    .from("teams")
    .insert({ key, name, ...common, manages_assets: bool(fd, "manages_assets"), sort_order: (last?.sort_order ?? 0) + 1 })
    .select("id")
    .single();
  if (error) return fail(error.code === "23505" ? "Another team already uses that short code." : dbError(error));

  const [sla, cat] = await Promise.all([
    supabase.from("sla_policies").insert(DEFAULT_SLA.map((p) => ({ ...p, team_id: team.id }))),
    supabase.from("categories").insert({ team_id: team.id, name: "Other", description: "Anything that doesn't fit another category.", sort_order: 99 }),
  ]);
  revalidatePath("/admin", "layout");
  if (sla.error || cat.error) {
    return ok(`Team created, but its default ${sla.error ? "SLA targets" : "category"} could not be added. Add them from the admin pages.`, `/admin/teams/${team.id}`);
  }
  return ok("Team created. Now add its agents.", `/admin/teams/${team.id}`);
}

export async function updateTeam(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = str(fd, "id");
  const g = await guardLead(id);
  if (g.error !== undefined) return fail(g.error);
  const common = readCommon(fd);
  if ("error" in common) return fail(common.error);

  // Leads may change how their team looks and works; only admins rename,
  // switch asset management or deactivate a team.
  const patch: { description: string | null; color: string; icon: string; auto_assign: boolean; name?: string; active?: boolean; manages_assets?: boolean } = { ...common };
  if (g.me.isAdmin) {
    const name = readName(fd);
    if (typeof name !== "string") return fail(name.error);
    patch.name = name;
    patch.active = bool(fd, "active");
    patch.manages_assets = bool(fd, "manages_assets");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("teams").update(patch).eq("id", id!).select("id");
  if (error) return fail(dbError(error));
  if (!data?.length) return fail("You don't have permission to change this team.");
  revalidatePath("/", "layout");
  return ok("Team updated");
}

/** Where to send a lead who just gave up leading `teamId`. */
function afterLosingLead(leadTeamIds: string[], teamId: string, fallback: string) {
  return leadTeamIds.some((t) => t !== teamId) ? "/admin/teams" : fallback;
}

const isRole = (v: unknown): v is "agent" | "lead" => v === "agent" || v === "lead";

export async function addMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const teamId = str(fd, "team_id");
  const g = await guardLead(teamId);
  if (g.error !== undefined) return fail(g.error);
  const employeeId = str(fd, "employee_id");
  if (!isUuid(employeeId)) return fail("Pick a person to add.");
  const role = str(fd, "role") ?? "agent";
  if (!isRole(role)) return fail("Pick a role.");

  const supabase = await createClient();
  const { data: person } = await supabase.from("people").select("id, full_name, status").eq("id", employeeId).maybeSingle();
  if (!person || person.status === "exited") return fail("That person is not an active employee.");

  const { error } = await supabase.from("team_members").insert({ team_id: teamId!, employee_id: employeeId, role });
  if (error) return fail(error.code === "23505" ? `${person.full_name ?? "This person"} is already on this team.` : dbError(error));
  revalidatePath(`/admin/teams/${teamId}`);
  revalidatePath("/admin/teams");
  return ok(`${person.full_name ?? "Person"} added as ${role === "lead" ? "a team lead" : "an agent"}`);
}

/** How many leads the team would have left after taking `employeeId` out of the lead role. */
async function leadsLeftWithout(supabase: Awaited<ReturnType<typeof createClient>>, teamId: string, employeeId: string) {
  const { count } = await supabase.from("team_members").select("employee_id", { count: "exact", head: true }).eq("team_id", teamId).eq("role", "lead").neq("employee_id", employeeId);
  return count ?? 0;
}

export async function setMemberRole(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const teamId = str(fd, "team_id");
  const g = await guardLead(teamId);
  if (g.error !== undefined) return fail(g.error);
  const employeeId = str(fd, "employee_id");
  if (!isUuid(employeeId)) return fail("Pick a team member.");
  const role = str(fd, "role");
  if (!isRole(role)) return fail("Pick a role.");

  const supabase = await createClient();
  const { data: member } = await supabase.from("team_members").select("role").eq("team_id", teamId!).eq("employee_id", employeeId).maybeSingle();
  if (!member) return fail("That person is no longer on this team.");
  if (member.role === role) return ok("No change needed");
  if (member.role === "lead" && !g.me.isAdmin && (await leadsLeftWithout(supabase, teamId!, employeeId)) === 0) {
    return fail("Every team needs at least one lead. Make someone else a lead first.");
  }

  const { error } = await supabase.from("team_members").update({ role }).eq("team_id", teamId!).eq("employee_id", employeeId);
  if (error) return fail(dbError(error));
  revalidatePath("/", "layout");
  const lostAccess = !g.me.isAdmin && employeeId === g.me.id && role === "agent";
  return ok(role === "lead" ? "Now a team lead" : "Now an agent", lostAccess ? afterLosingLead(g.me.leadTeamIds, teamId!, "/desk") : undefined);
}

export async function removeMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const teamId = str(fd, "team_id");
  const g = await guardLead(teamId);
  if (g.error !== undefined) return fail(g.error);
  const employeeId = str(fd, "employee_id");
  if (!isUuid(employeeId)) return fail("Pick a team member.");

  const supabase = await createClient();
  const { data: member } = await supabase.from("team_members").select("role").eq("team_id", teamId!).eq("employee_id", employeeId).maybeSingle();
  if (!member) return ok("Already removed");
  if (member.role === "lead" && !g.me.isAdmin && (await leadsLeftWithout(supabase, teamId!, employeeId)) === 0) {
    return fail("You can't remove the last lead. Make someone else a lead first.");
  }

  const { error } = await supabase.from("team_members").delete().eq("team_id", teamId!).eq("employee_id", employeeId);
  if (error) return fail(dbError(error));
  revalidatePath("/", "layout");
  const lostAccess = !g.me.isAdmin && employeeId === g.me.id;
  return ok("Removed from the team", lostAccess ? afterLosingLead(g.me.leadTeamIds, teamId!, "/home") : undefined);
}
