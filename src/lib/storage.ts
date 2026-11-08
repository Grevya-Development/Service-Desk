import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@/lib/constants";

const BUCKET = "servicedesk";

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * Reject files whose contents don't match their type (a renamed file, a
 * truncated download, an empty "PDF"), so nobody later opens a "corrupted"
 * document. Unknown types pass through.
 */
export async function assertReadable(file: File) {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const type = file.type.toLowerCase();
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const damaged = (kind: string) => new Error(`“${file.name}” isn't a valid ${kind} file — it may be damaged. Please re-export or re-scan it and try again.`);

  if (ext === "pdf" || type === "application/pdf") {
    if (!startsWith(head, ascii("%PDF-"))) throw damaged("PDF");
    // Every complete PDF ends with a cross-reference pointer and an EOF marker.
    const tail = new TextDecoder("latin1").decode(await file.slice(Math.max(0, file.size - 2048)).arrayBuffer());
    if (!tail.includes("startxref") || !tail.includes("%%EOF")) throw damaged("PDF");
    return;
  }
  if (ext === "png" || type === "image/png") {
    if (!startsWith(head, [0x89, 0x50, 0x4e, 0x47])) throw damaged("PNG");
  } else if (["jpg", "jpeg"].includes(ext) || type === "image/jpeg") {
    if (!startsWith(head, [0xff, 0xd8, 0xff])) throw damaged("JPEG");
  } else if (ext === "gif" || type === "image/gif") {
    if (!startsWith(head, ascii("GIF8"))) throw damaged("GIF");
  } else if (ext === "webp" || type === "image/webp") {
    if (!startsWith(head, ascii("RIFF")) || !startsWith(head, ascii("WEBP"), 8)) throw damaged("WebP");
  } else if (["docx", "xlsx", "pptx"].includes(ext)) {
    if (!startsWith(head, [0x50, 0x4b, 0x03, 0x04])) throw damaged(ext.toUpperCase());
  } else if (["doc", "xls", "ppt"].includes(ext)) {
    if (!startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) throw damaged(ext.toUpperCase());
  }
}

/** Files from a multi-file input, ignoring the empty placeholder browsers send. */
export function filesFrom(fd: FormData, key = "files"): File[] {
  return fd.getAll(key).filter((f): f is File => typeof f !== "string" && f.size > 0);
}

/** Validate before uploading anything; throws a friendly Error. */
export async function validateFiles(files: File[]) {
  if (files.length > MAX_ATTACHMENTS) throw new Error(`Attach up to ${MAX_ATTACHMENTS} files at a time`);
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) throw new Error("Attachments must be 4 MB or less in total");
  for (const f of files) await assertReadable(f);
}

export type StoredFile = { path: string; name: string; size: number; mime: string | null };

// Types the browser may render inline from a signed URL. Anything else (HTML, SVG, scripts…)
// is stored as a plain download so an attachment can't run script when an agent opens it.
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/csv"]);
const storedType = (type: string) => {
  const t = type.toLowerCase().split(";")[0].trim();
  if (!t) return undefined;
  return INLINE_TYPES.has(t) || /^application\/(vnd\.|msword|zip)/.test(t) ? t : "application/octet-stream";
};

/**
 * Upload validated files under tickets/<ticketId>/ with the service role.
 * Only call after the caller proved access to the ticket (RLS-checked read).
 */
export async function uploadTicketFiles(ticketId: string, files: File[]): Promise<StoredFile[]> {
  const admin = createAdminClient();
  const stored: StoredFile[] = [];
  for (const f of files) {
    const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
    const path = `tickets/${ticketId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, f, { contentType: storedType(f.type) });
    if (error) {
      await removeFiles(stored.map((s) => s.path));
      throw new Error(`Could not upload “${f.name}”: ${error.message}`);
    }
    stored.push({ path, name: f.name.slice(0, 200), size: f.size, mime: storedType(f.type) ?? null });
  }
  return stored;
}

export async function removeFiles(paths: string[]) {
  if (paths.length) await createAdminClient().storage.from(BUCKET).remove(paths);
}

/** Short-lived download URLs. Only for paths returned by an RLS-protected select. */
export async function signedUrls(paths: string[], expiresIn = 600): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await createAdminClient().storage.from(BUCKET).createSignedUrls(paths, expiresIn);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}
