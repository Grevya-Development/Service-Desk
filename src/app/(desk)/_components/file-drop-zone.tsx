"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileText, ImageIcon, Paperclip, UploadCloud, X } from "lucide-react";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function formatFileSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Problem with the chosen files (same limits as the server), or null when they're fine. */
export function filesProblem(files: File[]): string | null {
  if (files.length > MAX_ATTACHMENTS) return `You can attach up to ${MAX_ATTACHMENTS} files. Remove ${files.length - MAX_ATTACHMENTS} to continue.`;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) return `These files add up to ${formatFileSize(total)}. The limit is 4 MB in total, so remove one or two.`;
  return null;
}

/** Same name and size: treat as the same file picked or dropped twice. */
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size;

/** Pasted screenshots all arrive as "image.png": give them a readable, unique name. */
function namePasted(file: File, index: number): File {
  if (!/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file;
  const ext = file.name.split(".").pop()!.toLowerCase();
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  return new File([file], `Screenshot ${stamp}${index ? ` (${index + 1})` : ""}.${ext}`, { type: file.type, lastModified: Date.now() + index });
}

/** Put exactly `list` into a file input. */
function syncInput(input: HTMLInputElement | null, list: File[]) {
  if (!input) return;
  try {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(f);
    input.files = dt.files;
  } catch {
    // Very old browsers: the input keeps whatever was picked last.
  }
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "file", "button", "submit"].includes(el.type)));

/**
 * Attachments picker for server-action forms: choose files, drag and drop them
 * onto the box, or paste a screenshot anywhere in the surrounding form.
 * The real <input type="file" name="files"> is kept in sync (via DataTransfer),
 * so the form posts exactly the files listed. Controlled: the parent owns `files`
 * and can disable submit with `filesProblem(files)`.
 */
export function FileDropZone({
  files,
  onChange,
  label = "Attachments",
  hint = "Screenshots, photos or documents.",
  name = "files",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
  hint?: string;
  name?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Latest values for the form-level paste listener.
  const latest = useRef({ files, onChange });
  useEffect(() => {
    latest.current = { files, onChange };
  });

  // Keep the real file input in sync with the list (also after this component remounts).
  useEffect(() => {
    syncInput(inputRef.current, files);
  }, [files]);

  /** Add files to the list; returns the new list. */
  const add = (incoming: File[], pasted = false): File[] => {
    const current = latest.current.files;
    const fresh = incoming.map((f, i) => (pasted ? namePasted(f, i) : f)).filter((f) => !current.some((c) => sameFile(c, f)));
    const empty = fresh.filter((f) => f.size === 0);
    const usable = fresh.filter((f) => f.size > 0);
    setNotice(empty.length ? `${empty.map((f) => `“${f.name}”`).join(", ")} ${empty.length === 1 ? "is" : "are"} empty and can't be attached.` : null);
    if (!usable.length) return current;
    const next = [...current, ...usable];
    latest.current.onChange(next);
    return next;
  };

  // Paste a screenshot anywhere in the form (e.g. while typing the description).
  useEffect(() => {
    const form = zoneRef.current?.closest("form");
    if (!form) return;
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!data) return;
      const pastedFiles = Array.from(data.files ?? []);
      if (!pastedFiles.length) return;
      const hasText = Array.from(data.types).includes("text/plain") && data.getData("text/plain").trim() !== "";
      // Copying from Word/Excel puts both text and an image on the clipboard:
      // in a text box, paste the text as usual instead of attaching a picture.
      if (hasText && isEditable(e.target)) return;
      e.preventDefault();
      add(pastedFiles, true);
    };
    form.addEventListener("paste", onPaste);
    return () => form.removeEventListener("paste", onPaste);
  }, []);

  const remove = (index: number) => {
    setNotice(null);
    onChange(files.filter((_, i) => i !== index));
  };

  const problem = filesProblem(files);
  const total = files.reduce((n, f) => n + f.size, 0);

  return (
    <div ref={zoneRef}>
      <p id={`${id}-label`} className="mb-1.5 block text-xs font-medium text-slate-600">
        {label}
      </p>
      <div
        onDragEnter={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(Array.from(e.dataTransfer.files ?? []));
        }}
        className={cn(
          "relative rounded-lg border border-dashed px-4 py-5 text-center transition focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/25",
          dragging ? "border-primary-500 bg-primary-50" : "border-slate-300 bg-slate-50/60 hover:border-primary-400 hover:bg-primary-50/40",
        )}
      >
        <UploadCloud className={cn("mx-auto h-6 w-6", dragging ? "text-primary-600" : "text-slate-400")} aria-hidden />
        <p className="mt-1 text-sm text-slate-600">
          {dragging ? (
            <span className="font-medium text-primary-700">Drop to attach</span>
          ) : (
            <>
              <label htmlFor={`${id}-input`} className="cursor-pointer font-medium text-primary-600 hover:underline">
                Choose files
              </label>
              <span className="hidden sm:inline">, drag them here, or paste a screenshot</span>
            </>
          )}
        </p>
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-slate-500">
          {hint} Up to {MAX_ATTACHMENTS} files, 4 MB in total.
        </p>
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="file"
          name={name}
          multiple
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          className="sr-only"
          onChange={(e) => {
            // The list (not the input) is the source of truth: append, then put the whole list back
            // into the input (picking replaces its files; cancelling the dialog may clear them).
            syncInput(inputRef.current, add(Array.from(e.target.files ?? [])));
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="mt-2">
          <ul className="space-y-1.5" aria-label="Files to attach">
            {files.map((f, i) => (
              <FileRow key={`${f.name}-${f.size}-${f.lastModified}`} file={f} onRemove={() => remove(i)} />
            ))}
          </ul>
          <p className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {files.length} of {MAX_ATTACHMENTS} files · {formatFileSize(total)} of 4 MB
            </span>
            {files.length > 1 && (
              <button type="button" onClick={() => onChange([])} className="font-medium text-slate-500 hover:text-slate-800">
                Remove all
              </button>
            )}
          </p>
        </div>
      )}

      {(problem || notice) && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {problem ?? notice}
        </p>
      )}
    </div>
  );
}

function FileRow({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!isImage || !imgRef.current) return;
    const url = URL.createObjectURL(file);
    imgRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);
  const Icon = isImage ? ImageIcon : /pdf|word|text|sheet|document/i.test(file.type) ? FileText : Paperclip;

  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img ref={imgRef} alt="" className="h-9 w-9 shrink-0 rounded object-cover ring-1 ring-slate-200" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-400">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-800">{file.name}</span>
        <span className="block text-xs text-slate-500">{formatFileSize(file.size)}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}
