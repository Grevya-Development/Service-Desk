"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str } from "@/lib/utils";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Approve or reject a request waiting on the viewer. The database checks who may decide. */
export async function decideApproval(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");

  const id = str(fd, "id");
  const decision = str(fd, "decision");
  const comment = str(fd, "remarks");
  if (!id || !UUID_RE.test(id)) return fail("Approval not found");
  if (decision !== "approve" && decision !== "reject") return fail("Choose approve or reject");
  const approve = decision === "approve";
  if (!approve && !comment) return fail("Add a reason for rejecting");
  if (comment && comment.length > 1000) return fail("Please keep your comment under 1000 characters");

  const supabase = await createClient();
  const { data: approval } = await supabase.from("approvals").select("id, ticket:tickets(number)").eq("id", id).maybeSingle();
  if (!approval) return fail("Approval not found");

  const { error } = await supabase.rpc("decide_approval", { p_id: id, p_approve: approve, p_comment: comment ?? undefined });
  if (error) return fail(dbError(error));

  const number = (approval.ticket as unknown as { number: number } | null)?.number;
  if (number) {
    revalidatePath(`/requests/${number}`);
    revalidatePath(`/desk/tickets/${number}`);
  }
  // Layout too: the sidebar shows the waiting-approvals count.
  revalidatePath("/", "layout");
  return ok(approve ? "Request approved" : "Request rejected");
}
