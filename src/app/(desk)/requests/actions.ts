"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str } from "@/lib/utils";
import { isPriority, ticketRef } from "@/lib/constants";
import { filesFrom, validateFiles } from "@/lib/storage";
import { attachFiles } from "@/lib/tickets/files";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Report an issue": the signed-in employee raises an incident for themselves. */
export async function createRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("You're not signed in. Please sign in again.");

  const teamId = str(fd, "team_id");
  const categoryId = str(fd, "category_id");
  const subject = str(fd, "subject");
  const description = str(fd, "description");
  const priority = str(fd, "priority") ?? "medium";
  const assetId = str(fd, "asset_id");

  if (!teamId || !UUID_RE.test(teamId)) return fail("Choose who can help you");
  if (categoryId && !UUID_RE.test(categoryId)) return fail("Choose a topic from the list");
  if (assetId && !UUID_RE.test(assetId)) return fail("Choose a device from the list");
  if (!subject || subject.length < 3) return fail("Add a short summary (at least 3 characters)");
  if (subject.length > 200) return fail("Keep the summary under 200 characters");
  if (!description) return fail("Describe what's happening");
  if (description.length > 20000) return fail("The description is too long (20,000 characters max)");
  if (!isPriority(priority)) return fail("Choose how urgent this is");

  const files = filesFrom(fd);
  try {
    await validateFiles(files);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "One of the files can't be attached");
  }

  const supabase = await createClient();
  const [{ data: team }, { data: categories }, { data: asset }] = await Promise.all([
    supabase.from("teams").select("id, active").eq("id", teamId).maybeSingle(),
    supabase.from("categories").select("id").eq("team_id", teamId).eq("active", true),
    assetId ? supabase.from("assets").select("id, assigned_to").eq("id", assetId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!team || !team.active) return fail("That team isn't taking requests right now. Please choose another.");
  const activeCategories = categories ?? [];
  if (categoryId && !activeCategories.some((c) => c.id === categoryId)) return fail("That topic isn't available. Please choose another.");
  if (!categoryId && activeCategories.length) return fail("Choose what this is about");
  if (assetId && (!asset || asset.assigned_to !== me.id)) return fail("You can only pick a device that's assigned to you");

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      requester_id: me.id,
      team_id: teamId,
      category_id: categoryId,
      subject,
      description,
      priority,
      asset_id: assetId,
      type: "incident",
    })
    .select("id, number")
    .single();
  if (error || !ticket) return fail(dbError(error, "We couldn't raise your request. Please try again."));

  const fileError = await attachFiles(ticket.id, files, null);
  revalidatePath("/requests");
  revalidatePath("/home");
  const ref = ticketRef(ticket.number);
  if (fileError) return ok(`${ref} raised, but your files couldn't be attached (${fileError}). You can add them in a reply.`, `/requests/${ticket.number}`);
  return ok(`${ref} raised. We'll keep you posted here.`, `/requests/${ticket.number}`);
}
