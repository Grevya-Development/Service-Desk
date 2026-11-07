import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type TeamRole = "agent" | "lead";
export type Membership = { teamId: string; teamKey: string; teamName: string; color: string; role: TeamRole; managesAssets: boolean };

export type Viewer = {
  /** public.employees.id */
  id: string;
  name: string;
  firstName: string;
  email: string;
  avatarUrl: string | null;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  managerId: string | null;
  /** People Success role (employee | manager | hr_admin | super_admin) */
  role: string;
  memberships: Membership[];
  /** Desk admin = People Success super admin */
  isAdmin: boolean;
  /** Member of any team (or admin) */
  isAgent: boolean;
  /** Lead of any team (or admin) */
  isLead: boolean;
  /** Can manage the asset register */
  managesAssets: boolean;
  /** Team ids this viewer works as an agent (all teams for admins) */
  agentTeamIds: string[];
  /** Team ids this viewer leads (all teams for admins) */
  leadTeamIds: string[];
};

/** Signed-in employee + desk roles for this request (deduplicated per request). */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const { data: emp } = await supabase
    .schema("public")
    .from("employees")
    .select("id, full_name, first_name, email, avatar_url, employee_code, manager_id, role, status, designation:designations(title), department:departments(name)")
    .eq("user_id", userId)
    .neq("status", "exited")
    .maybeSingle();
  if (!emp) return null;

  const [{ data: members }, { data: teams }] = await Promise.all([
    supabase.from("team_members").select("role, team:teams(id, key, name, color, manages_assets, active)").eq("employee_id", emp.id),
    supabase.from("teams").select("id, key, name, color, manages_assets, active").order("sort_order"),
  ]);

  const isAdmin = emp.role === "super_admin";
  const memberships: Membership[] = (members ?? [])
    .filter((m) => m.team?.active)
    .map((m) => ({
      teamId: m.team!.id,
      teamKey: m.team!.key,
      teamName: m.team!.name,
      color: m.team!.color,
      role: m.role as TeamRole,
      managesAssets: m.team!.manages_assets,
    }));
  const allTeamIds = (teams ?? []).map((t) => t.id);
  const agentTeamIds = isAdmin ? allTeamIds : memberships.map((m) => m.teamId);
  const leadTeamIds = isAdmin ? allTeamIds : memberships.filter((m) => m.role === "lead").map((m) => m.teamId);
  const designation = emp.designation as unknown as { title: string } | null;
  const department = emp.department as unknown as { name: string } | null;

  return {
    id: emp.id,
    name: emp.full_name ?? emp.first_name,
    firstName: emp.first_name,
    email: emp.email,
    avatarUrl: emp.avatar_url,
    employeeCode: emp.employee_code,
    designation: designation?.title ?? null,
    department: department?.name ?? null,
    managerId: emp.manager_id,
    role: emp.role,
    memberships,
    isAdmin,
    isAgent: isAdmin || memberships.length > 0,
    isLead: isAdmin || memberships.some((m) => m.role === "lead"),
    managesAssets: isAdmin || memberships.some((m) => m.managesAssets),
    agentTeamIds,
    leadTeamIds,
  };
});

/** Use at the top of every page / server action. */
export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    redirect(data?.claims?.sub ? "/no-access" : "/login");
  }
  return v;
}

export async function requireAgent(): Promise<Viewer> {
  const v = await requireViewer();
  if (!v.isAgent) redirect("/home?denied=1");
  return v;
}

export async function requireLead(): Promise<Viewer> {
  const v = await requireViewer();
  if (!v.isLead) redirect("/home?denied=1");
  return v;
}

export async function requireAdmin(): Promise<Viewer> {
  const v = await requireViewer();
  if (!v.isAdmin) redirect("/home?denied=1");
  return v;
}

export async function requireAssetManager(): Promise<Viewer> {
  const v = await requireViewer();
  if (!v.managesAssets) redirect("/home?denied=1");
  return v;
}
