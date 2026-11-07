import { requireViewer, type Viewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildNav } from "@/lib/nav";
import { DeskShell } from "@/components/shell/desk-shell";

function roleLabel(v: Viewer) {
  if (v.isAdmin) return "Desk admin";
  const lead = v.memberships.find((m) => m.role === "lead");
  if (lead) return `${lead.teamName} lead`;
  if (v.memberships.length) return `${v.memberships.map((m) => m.teamName).join(" & ")} agent`;
  return "Employee";
}

export default async function DeskLayout({ children }: LayoutProps<"/">) {
  const me = await requireViewer();
  const supabase = await createClient();

  const head = { count: "exact" as const, head: true };
  const [notes, unread, myApprovals, leadApprovals, unassigned, reports] = await Promise.all([
    supabase.from("notifications").select("id, title, body, link, read_at, created_at").eq("employee_id", me.id).order("created_at", { ascending: false }).limit(12),
    supabase.from("notifications").select("id", head).eq("employee_id", me.id).is("read_at", null),
    supabase.from("approvals").select("id", head).eq("status", "pending").eq("approver_id", me.id),
    me.leadTeamIds.length
      ? supabase.from("approvals").select("id", head).eq("status", "pending").in("team_id", me.leadTeamIds)
      : Promise.resolve({ count: 0 }),
    me.agentTeamIds.length
      ? supabase.from("tickets").select("id", head).in("team_id", me.agentTeamIds).is("assignee_id", null).in("status", ["new", "open"]).neq("approval_status", "pending")
      : Promise.resolve({ count: 0 }),
    supabase.schema("public").from("employees").select("id", head).eq("manager_id", me.id).neq("status", "exited"),
  ]);

  const approvals = (myApprovals.count ?? 0) + (leadApprovals.count ?? 0);
  const sections = buildNav(
    { isAgent: me.isAgent, isLead: me.isLead, isAdmin: me.isAdmin, managesAssets: me.managesAssets, showApprovals: me.isLead || (reports.count ?? 0) > 0 },
    { approvals, unassigned: unassigned.count ?? 0 },
  );

  return (
    <DeskShell
      sections={sections}
      user={{ name: me.name, email: me.email, avatarUrl: me.avatarUrl, designation: me.designation, roleLabel: roleLabel(me) }}
      notifications={notes.data ?? []}
      unread={unread.count ?? 0}
      isAgent={me.isAgent}
      peopleSuccessUrl={process.env.PEOPLE_SUCCESS_URL || "https://peoplesuccess.vercel.app"}
    >
      {children}
    </DeskShell>
  );
}
