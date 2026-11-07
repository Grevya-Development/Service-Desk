"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@/lib/constants";
import { formatBytes } from "./format";

export const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

/**
 * Files chosen for one message. Keeps the real `<input type="file" name="files">`
 * (attach `inputRef`) in sync via DataTransfer so the form posts exactly the
 * listed files, and enforces 5 files / 4 MB in total before upload.
 */
export function useFileAttachments() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    const input = inputRef.current;
    if (!input || typeof DataTransfer === "undefined") return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
  }, [files]);

  const addFiles = (incoming: File[]) => {
    const next = [...files];
    const seen = new Set(next.map(fileKey));
    let total = next.reduce((n, f) => n + f.size, 0);
    let problem: string | null = null;
    for (const f of incoming) {
      if (!f.size || seen.has(fileKey(f))) continue;
      if (next.length >= MAX_ATTACHMENTS) {
        problem = `You can attach up to ${MAX_ATTACHMENTS} files to one message.`;
        break;
      }
      if (total + f.size > MAX_ATTACHMENT_BYTES) {
        problem = `“${f.name}” doesn't fit: attachments must be 4 MB or less in total.`;
        continue;
      }
      next.push(f);
      seen.add(fileKey(f));
      total += f.size;
    }
    if (problem) toast.error(problem);
    // Always set a new array: the effect also restores the input after the browser replaced its files.
    setFiles(next);
  };

  const removeFile = (key: string) => setFiles((cur) => cur.filter((f) => fileKey(f) !== key));

  /** Paste handler for a text box: attaches pasted screenshots (clipboard with files but no text). */
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const pasted = Array.from(e.clipboardData.files);
    if (!pasted.length || e.clipboardData.getData("text/plain")) return;
    e.preventDefault();
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
    addFiles(
      pasted.map((f, i) =>
        /^image\.\w+$/i.test(f.name)
          ? new File([f], `pasted-image-${stamp}${pasted.length > 1 ? `-${i + 1}` : ""}.${f.name.split(".").pop()}`, { type: f.type, lastModified: Date.now() + i })
          : f,
      ),
    );
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  /** Spread on the drop zone. */
  const dropProps = {
    onDragEnter: (e: DragEvent<HTMLElement>) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
  };

  /** Props for the hidden file input. Picking again adds to the list instead of replacing it. */
  const inputProps = {
    ref: inputRef,
    type: "file" as const,
    name: "files",
    multiple: true,
    className: "sr-only",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => addFiles(Array.from(e.target.files ?? [])),
  };

  return { files, setFiles, addFiles, removeFile, onPaste, dropProps, inputProps, dragging, totalBytes: files.reduce((n, f) => n + f.size, 0) };
}

/** Chosen files with remove buttons. */
export function FileChips({ files, onRemove, className }: { files: File[]; onRemove: (key: string) => void; className?: string }) {
  if (!files.length) return null;
  return (
    <ul className={className ?? "flex flex-wrap gap-1.5"} aria-label="Files to send">
      {files.map((f) => (
        <li key={fileKey(f)} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1 pl-2.5 pr-1 text-xs text-slate-700">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="max-w-[12rem] truncate" title={f.name}>
            {f.name}
          </span>
          <span className="shrink-0 text-slate-400">{formatBytes(f.size)}</span>
          <button type="button" onClick={() => onRemove(fileKey(f))} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Remove ${f.name}`}>
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
