import { CheckCheck, History } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { LinkTabs } from "@/components/ui/link-tabs";
import { ApprovalCard } from "./_components/approval-card";
import { DecidedList } from "./_components/decided-list";
import { APPROVAL_SELECT, type ApprovalRow, type ApprovalWithTicket } from "./_lib/data";

export const metadata = { title: "Approvals" };

const withTicket = (rows: unknown): ApprovalWithTicket[] => ((rows ?? []) as ApprovalRow[]).filter((r): r is ApprovalWithTicket => r.ticket !== null);

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const me = await requireViewer();
  const { tab } = await searchParams;
  const showDecided = tab === "decided";
  const supabase = await createClient();

  // Waiting on me: I'm the named approver (manager), or I lead the approving team.
  let waitingQuery = supabase.from("approvals").select(APPROVAL_SELECT).eq("status", "pending").order("created_at", { ascending: true });
  waitingQuery = me.leadTeamIds.length ? waitingQuery.or(`approver_id.eq.${me.id},team_id.in.(${me.leadTeamIds.join(",")})`) : waitingQuery.eq("approver_id", me.id);

  const [waitingRes, decidedRes] = await Promise.all([
    waitingQuery,
    supabase.from("approvals").select(APPROVAL_SELECT).eq("decided_by", me.id).order("decided_at", { ascending: false }).limit(20),
  ]);
  if (waitingRes.error || decidedRes.error) throw new Error("We couldn't load your approvals. Please try again.");

  const waiting = withTicket(waitingRes.data);
  const decided = withTicket(decidedRes.data);
  // Leads see their own team-lead requests here too, but can't approve them (desk admins can).
  const isOwn = (a: ApprovalWithTicket) => a.ticket.requester_id === me.id && !me.isAdmin;
  const actionable = waiting.filter((a) => !isOwn(a)).length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Approvals"
        description="Requests from your team that need your OK before work can start."
        breadcrumbs={[{ label: "Home", href: "/home" }, { label: "Approvals" }]}
      />

      <LinkTabs
        tabs={[
          { label: "Waiting for you", href: "/approvals", count: actionable },
          { label: "Decided", href: "/approvals?tab=decided" },
        ]}
      />

      {showDecided ? (
        <Card>
          {decided.length ? (
            <>
              <div className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">{decided.length === 1 ? "Your most recent decision" : `Your last ${decided.length} decisions`}</div>
              <DecidedList approvals={decided} />
            </>
          ) : (
            <EmptyState icon={History} title="No decisions yet" description="Requests you approve or reject will be listed here." />
          )}
        </Card>
      ) : waiting.length ? (
        <div className="space-y-4">
          {waiting.map((a) => (
            <ApprovalCard key={a.id} approval={a} isOwn={isOwn(a)} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={CheckCheck} title="Nothing waiting for you" description="When someone needs your OK for a request, it will show up here and you'll get a notification." />
        </Card>
      )}
    </div>
  );
}
