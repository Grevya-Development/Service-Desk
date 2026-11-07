"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { BookOpen, FileText, Loader2, Lock, MessageSquare, Paperclip, Send, Upload } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { postMessage } from "@/lib/tickets/actions";
import { searchArticles, type ArticleHit } from "@/lib/kb/search";
import { MAX_ATTACHMENTS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatBytes } from "./format";
import { ignoreHotkey } from "./hotkeys";
import { FileChips, useFileAttachments } from "./attachments";

export type ComposerTemplate = { id: string; title: string; body: string };

/** Replace {{key}} placeholders; unknown keys are left as typed so the agent notices them. */
export function fillPlaceholders(body: string, values: Record<string, string | null | undefined> = {}) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => values[key.toLowerCase()] ?? whole);
}

const noopSubscribe = () => () => undefined;

/**
 * Reply box. Everyone can paste or drop files. Agents get a Reply / Internal note
 * toggle (`canNote`) and, optionally, reply templates, article links and r / n hotkeys.
 */
export function Composer({
  ticketId,
  canNote = false,
  placeholder,
  templates,
  placeholders,
  onTemplateUse,
  articles = false,
  hotkeys = false,
}: {
  ticketId: string;
  canNote?: boolean;
  placeholder?: string;
  /** Reply templates to offer (agents). */
  templates?: ComposerTemplate[];
  /** Values for {{first_name}}, {{ticket}}, {{agent_name}}… in templates. */
  placeholders?: Record<string, string | null | undefined>;
  /** Called with the template id after one is inserted (e.g. to count uses). */
  onTemplateUse?: (id: string) => Promise<void> | void;
  /** Offer "Insert article link" (published knowledge base articles). */
  articles?: boolean;
  /** Agents: "r" focuses the reply, "n" the internal note. */
  hotkeys?: boolean;
}) {
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState("");
  const { files, setFiles, removeFile, onPaste, dropProps, inputProps, dragging, totalBytes } = useFileAttachments();
  const [picker, setPicker] = useState<null | "templates" | "articles">(null);
  const isMac = useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitted = useRef<{ body: string; files: File[] } | null>(null);

  const focusBox = (asNote: boolean) => {
    if (canNote) setInternal(asNote);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (ignoreHotkey(e) || e.shiftKey) return;
      if (e.key === "r" || (e.key === "n" && canNote)) {
        e.preventDefault();
        focusBox(e.key === "n");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focusBox only reads refs and stable setters
  }, [hotkeys, canNote]);

  const insertAtCursor = (text: string, block: boolean) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const lead = !before ? "" : block ? (before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") : /\s$/.test(before) ? "" : " ";
    const insert = lead + text;
    const next = (before + insert + after).slice(0, 20000);
    setBody(next);
    const pos = Math.min(before.length + insert.length, next.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const applyTemplate = (t: ComposerTemplate) => {
    insertAtCursor(fillPlaceholders(t.body, placeholders), true);
    setPicker(null);
    Promise.resolve(onTemplateUse?.(t.id)).catch(() => undefined);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const form = e.currentTarget.form;
      const button = form?.querySelector<HTMLButtonElement>("button[type=submit]");
      if (!form || !button || button.disabled) return;
      form.requestSubmit(button);
    }
  };

  const sendKey = isMac ? "⌘ Enter" : "Ctrl Enter";
  const hasTemplates = Boolean(templates);

  return (
    <div
      {...dropProps}
      onSubmitCapture={() => {
        submitted.current = { body, files };
      }}
      className="relative"
    >
      <ActionForm
        action={postMessage}
        resetOnSuccess={false}
        onSuccess={() => {
          const sent = submitted.current;
          submitted.current = null;
          // Keep anything typed or attached while the message was sending.
          setBody((cur) => (sent && cur !== sent.body ? cur : ""));
          setFiles((cur) => (sent ? cur.filter((f) => !sent.files.includes(f)) : []));
        }}
        className={cn("rounded-xl border bg-white p-3 transition-colors focus-within:ring-2 focus-within:ring-primary-500/20", internal ? "border-amber-300 bg-amber-50/40" : "border-slate-200", dragging && "border-primary-500 ring-2 ring-primary-500/20")}
      >
        <input type="hidden" name="ticket_id" value={ticketId} />
        <input type="hidden" name="internal" value={internal ? "on" : ""} />
        {canNote && (
          <div className="mb-2 flex gap-1 text-xs" role="group" aria-label="Message type">
            <button
              type="button"
              onClick={() => setInternal(false)}
              aria-pressed={!internal}
              aria-keyshortcuts={hotkeys ? "r" : undefined}
              className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium", !internal ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:bg-slate-100")}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Reply to requester
            </button>
            <button
              type="button"
              onClick={() => setInternal(true)}
              aria-pressed={internal}
              aria-keyshortcuts={hotkeys ? "n" : undefined}
              className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium", internal ? "bg-amber-100 text-amber-800" : "text-slate-500 hover:bg-slate-100")}
            >
              <Lock className="h-3.5 w-3.5" /> Internal note
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          name="body"
          rows={4}
          maxLength={20000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? (internal ? "Only agents can see this note…" : "Write a reply…")}
          aria-label={internal ? "Internal note" : "Reply"}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          className="block w-full resize-y rounded-lg border-0 bg-transparent px-1 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
        />

        <FileChips files={files} onRemove={removeFile} className="mt-2 flex flex-wrap gap-1.5" />

        <div className="relative mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <div className="flex flex-wrap items-center gap-1">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-600 focus-within:ring-2 focus-within:ring-primary-500 hover:bg-slate-100">
              <Paperclip className="h-3.5 w-3.5" />
              {files.length ? `${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(totalBytes)}` : "Attach files"}
              <input {...inputProps} />
            </label>
            {hasTemplates && (
              <Picker label="Templates" icon={FileText} open={picker === "templates"} onOpenChange={(o) => setPicker(o ? "templates" : null)}>
                <TemplateSearch templates={templates!} onPick={applyTemplate} />
              </Picker>
            )}
            {articles && (
              <Picker label="Article link" icon={BookOpen} open={picker === "articles"} onOpenChange={(o) => setPicker(o ? "articles" : null)}>
                <ArticleSearch
                  onPick={(a) => {
                    insertAtCursor(`[${a.title.replace(/([[\]])/g, "\\$1")}](/kb/${a.slug})`, false);
                    setPicker(null);
                  }}
                />
              </Picker>
            )}
          </div>
          <SubmitButton size="sm" variant={internal ? "secondary" : "primary"}>
            <Send className="h-3.5 w-3.5" /> {internal ? "Add note" : "Send"}
          </SubmitButton>
        </div>
        <p className="mt-1 px-1 text-[11px] text-slate-400">
          Markdown: **bold**, *italic*, lists, links. Paste or drop up to {MAX_ATTACHMENTS} files (4 MB in total). <span className="hidden sm:inline">{sendKey} to send.</span>
        </p>
      </ActionForm>
      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-primary-50/80 text-sm font-medium text-primary-700">
          <Upload className="mr-2 h-4 w-4" /> Drop files to attach
        </div>
      )}
    </div>
  );
}

/** Small popover anchored to a toolbar button; closes on Escape or outside click. */
function Picker({ label, icon: Icon, open, onOpenChange, children }: { label: string; icon: typeof FileText; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);
  return (
    <div
      ref={ref}
      className="sm:relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          onOpenChange(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100", open && "bg-slate-100 text-slate-800")}
      >
        <Icon className="h-3.5 w-3.5" /> {label}
      </button>
      {open && (
        <div role="dialog" aria-label={label} className="absolute bottom-full left-0 right-0 z-30 mb-1 rounded-xl sm:right-auto sm:w-[22rem] border border-slate-200 bg-white p-2 shadow-xl">
          {children}
        </div>
      )}
    </div>
  );
}

function PickerList<T>({ items, render, onPick, empty, keyOf }: { items: T[]; render: (item: T) => ReactNode; onPick: (item: T) => void; empty: ReactNode; keyOf: (item: T) => string }) {
  if (!items.length) return <p className="px-2 py-3 text-center text-xs text-slate-400">{empty}</p>;
  return (
    <ul className="thin-scroll mt-1 max-h-60 overflow-y-auto">
      {items.map((item) => (
        <li key={keyOf(item)}>
          <button type="button" onClick={() => onPick(item)} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus:bg-primary-50 focus:outline-none">
            {render(item)}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SearchInput({ value, onChange, placeholder, onEnter, busy }: { value: string; onChange: (v: string) => void; placeholder: string; onEnter: () => void; busy?: boolean }) {
  return (
    <div className="relative">
      <input
        autoFocus
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            (e.currentTarget.closest("[role=dialog]")?.querySelector("li button") as HTMLButtonElement | null)?.focus();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full rounded-lg border border-slate-300 px-2.5 pr-7 text-xs focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
      />
      {busy && <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />}
    </div>
  );
}

/** Arrow keys move between results inside a picker. */
function onListKeys(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("li button"));
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const next = e.key === "ArrowDown" ? buttons[i + 1] : buttons[i - 1];
  if (next) next.focus();
  else if (e.key === "ArrowUp") e.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
}

function TemplateSearch({ templates, onPick }: { templates: ComposerTemplate[]; onPick: (t: ComposerTemplate) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? templates.filter((t) => t.title.toLowerCase().includes(s) || t.body.toLowerCase().includes(s)) : templates;
  }, [templates, q]);
  return (
    <div onKeyDown={onListKeys}>
      <SearchInput value={q} onChange={setQ} placeholder="Search templates" onEnter={() => shown[0] && onPick(shown[0])} />
      <PickerList
        items={shown}
        keyOf={(t) => t.id}
        onPick={onPick}
        empty={templates.length ? "No templates match." : "Your team has no reply templates yet. Add them under Reply templates."}
        render={(t) => (
          <>
            <span className="block truncate text-xs font-medium text-slate-800">{t.title}</span>
            <span className="line-clamp-2 text-[11px] text-slate-500">{t.body}</span>
          </>
        )}
      />
    </div>
  );
}

function ArticleSearch({ onPick }: { onPick: (a: ArticleHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ArticleHit[]>([]);
  const [busy, setBusy] = useState(false);
  const term = q.trim();
  useEffect(() => {
    if (term.length < 3) return;
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      searchArticles(term, 8)
        .then((r) => live && setHits(r))
        .catch(() => live && setHits([]))
        .finally(() => live && setBusy(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);
  const shown = term.length < 3 ? [] : hits;
  return (
    <div onKeyDown={onListKeys}>
      <SearchInput value={q} onChange={setQ} placeholder="Search published articles" onEnter={() => shown[0] && onPick(shown[0])} busy={busy} />
      <PickerList
        items={shown}
        keyOf={(a) => a.id}
        onPick={onPick}
        empty={term.length < 3 ? "Type at least 3 letters." : busy ? "Searching…" : "No published articles match."}
        render={(a) => (
          <>
            <span className="block truncate text-xs font-medium text-slate-800">{a.title}</span>
            {a.summary && <span className="line-clamp-1 text-[11px] text-slate-500">{a.summary}</span>}
          </>
        )}
      />
    </div>
  );
}
