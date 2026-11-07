"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { isPriority } from "@/lib/constants";
import { str } from "@/lib/utils";
import { filesFrom, validateFiles } from "@/lib/storage";
import { attachFiles } from "@/lib/tickets/files";
import { MAX_DESCRIPTION, MAX_NOTE, answersMarkdown, parseFields, readAnswers } from "./_lib/fields";
import { UUID_RE } from "./_lib/copy";

/** Submit a service catalog request: validates answers against the item's fields and creates a `request` ticket. */
export async function submitCatalogRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");

  const itemId = str(fd, "item_id");
  if (!itemId || !UUID_RE.test(itemId)) return fail("That service is no longer available");

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("catalog_items")
    .select("id, name, team_id, category_id, fields, default_priority, active, team:teams(active)")
    .eq("id", itemId)
    .maybeSingle();
  const team = item?.team as unknown as { active: boolean } | null;
  if (!item || !item.active || !team?.active) return fail("That service is no longer available");

  const fields = parseFields(item.fields);
  const result = readAnswers(fields, fd);
  if ("error" in result) return fail(result.error);
  const { answers } = result;

  const note = str(fd, "description");
  if (note && note.length > MAX_NOTE) return fail(`Please keep the extra details under ${MAX_NOTE} characters`);

  const priorityInput = str(fd, "priority");
  if (priorityInput && !isPriority(priorityInput)) return fail("Choose a valid priority");
  const priority = priorityInput ?? (isPriority(item.default_priority) ? item.default_priority : "medium");

  const files = filesFrom(fd);
  try {
    await validateFiles(files);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid file");
  }

  // Subject: item name, plus the first short-text answer for context.
  const firstText = fields.find((f) => f.type === "text" && typeof answers[f.key] === "string");
  const extra = firstText ? String(answers[firstText.key]).replace(/\s+/g, " ") : "";
  let subject = extra ? `${item.name} – ${extra}` : item.name;
  if (subject.length > 200) subject = `${subject.slice(0, 199).trimEnd()}…`;
  if (subject.length < 3) subject = `${item.name} request`;

  // The description is required by the database: fall back to the answers, then to a plain sentence.
  let description = note ?? (answersMarkdown(fields, answers) || `Requested “${item.name}” from the service catalog.`);
  if (description.length > MAX_DESCRIPTION) description = `${description.slice(0, MAX_DESCRIPTION - 1)}…`;

  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({
      catalog_item_id: item.id,
      team_id: item.team_id,
      category_id: item.category_id,
      requester_id: me.id,
      type: "request",
      subject,
      description,
      priority,
      form_data: answers,
    })
    .select("id, number")
    .single();
  if (error || !ticket) return fail(dbError(error, "We couldn't submit your request. Please try again."));

  const fileError = await attachFiles(ticket.id, files, null);

  revalidatePath("/requests");
  revalidatePath("/approvals");
  revalidatePath("/desk");

  const to = `/requests/${ticket.number}`;
  if (fileError) return ok(`Request submitted, but your files couldn't be attached (${fileError}). You can add them from the request page.`, to);
  return ok("Request submitted", to);
}
