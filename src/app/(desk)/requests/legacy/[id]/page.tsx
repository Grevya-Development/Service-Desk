import { notFound, redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "../../_lib/query";

/**
 * Old People Success HR helpdesk links land here with the helpdesk ticket id.
 * Forward to the imported desk ticket (agent view for that team's agents).
 */
export default async function LegacyTicketRedirect({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireViewer();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data: ticket } = await supabase.from("tickets").select("number, team_id, requester_id").eq("legacy_id", id.toLowerCase()).maybeSingle();
  if (!ticket) notFound();

  const agentView = ticket.requester_id !== me.id && me.agentTeamIds.includes(ticket.team_id);
  redirect(agentView ? `/desk/tickets/${ticket.number}` : `/requests/${ticket.number}`);
}
