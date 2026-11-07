import "server-only";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/actions";
import { removeFiles, uploadTicketFiles } from "@/lib/storage";

/**
 * Store files for a ticket (and optionally a message) after an RLS-checked
 * insert. Shared by ticket creation and replies. Returns an error message or null.
 */
export async function attachFiles(ticketId: string, files: File[], messageId: string | null): Promise<string | null> {
  if (!files.length) return null;
  const me = await getViewer();
  if (!me) return "Not signed in";
  let stored;
  try {
    stored = await uploadTicketFiles(ticketId, files);
  } catch (e) {
    return e instanceof Error ? e.message : "Upload failed";
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("attachments")
    .insert(stored.map((s) => ({ ticket_id: ticketId, message_id: messageId, path: s.path, name: s.name, size: s.size, mime: s.mime, uploaded_by: me.id })));
  if (error) {
    await removeFiles(stored.map((s) => s.path));
    return dbError(error);
  }
  return null;
}

