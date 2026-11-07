"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str } from "@/lib/utils";
import { UUID_RE } from "../../status/_lib/incident";
import { BODY_MAX, STARTERS, TITLE_MAX, unknownPlaceholders } from "./_lib/templates";

/** Trimmed text with browser CRLF line endings normalised to "\n". */
function text(fd: FormData, key: string) {
  return str(fd, key)?.replace(/\r\n?/g, "\n") ?? null;
}

export async function saveTemplate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const id = str(fd, "id");
  if (id && !UUID_RE.test(id)) return fail("We couldn't find that template.");
  const teamId = str(fd, "team_id");
  if (!teamId || !UUID_RE.test(teamId) || !me.agentTeamIds.includes(teamId)) return fail("Choose one of your teams.");
  const title = str(fd, "title");
  if (!title || title.length < 2) return fail("Give the template a short name (at least 2 characters).");
  if (title.length > TITLE_MAX) return fail(`Keep the name under ${TITLE_MAX} characters.`);
  const body = text(fd, "body");
  if (!body) return fail("Write the reply text.");
  if (body.length > BODY_MAX) return fail(`Keep the reply under ${BODY_MAX.toLocaleString("en-IN")} characters.`);
  const unknown = unknownPlaceholders(body);
  if (unknown.length) return fail(`${unknown.slice(0, 3).join(", ")} won't be filled in. Use {{first_name}}, {{ticket}} or {{agent_name}}.`);

  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("canned_responses").update({ team_id: teamId, title, body }).eq("id", id).select("id");
    if (error) return fail(dbError(error));
    if (!data?.length) return fail("We couldn't find that template, or you can't edit it.");
  } else {
    const { error } = await supabase.from("canned_responses").insert({ team_id: teamId, title, body, created_by: me.id });
    if (error) return fail(dbError(error));
  }
  revalidatePath("/desk/templates");
  return ok(id ? "Template saved" : "Template added");
}

export async function deleteTemplate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const id = str(fd, "id");
  if (!id || !UUID_RE.test(id)) return fail("We couldn't find that template.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("canned_responses").delete().eq("id", id).select("id");
  if (error) return fail(dbError(error));
  if (!data?.length) return fail("We couldn't find that template, or you can't delete it.");
  revalidatePath("/desk/templates");
  return ok("Template deleted");
}

/** One-click add of a suggested starter template. */
export async function addStarter(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Please sign in again.");
  const starter = STARTERS.find((s) => s.key === str(fd, "key"));
  if (!starter) return fail("We couldn't find that starter.");
  const teamId = str(fd, "team_id");
  if (!teamId || !UUID_RE.test(teamId) || !me.agentTeamIds.includes(teamId)) return fail("Choose one of your teams.");

  const supabase = await createClient();
  const { data: existing } = await supabase.from("canned_responses").select("id").eq("team_id", teamId).eq("title", starter.title).limit(1);
  if (existing?.length) return fail(`Your team already has “${starter.title}”.`);
  const { error } = await supabase.from("canned_responses").insert({ team_id: teamId, title: starter.title, body: starter.body, created_by: me.id });
  if (error) return fail(dbError(error));
  revalidatePath("/desk/templates");
  return ok(`Added “${starter.title}”. Edit it any time.`);
}
