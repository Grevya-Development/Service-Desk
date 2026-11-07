"use client";

import { useState } from "react";
import { Lock, MessageSquare, Paperclip, Send } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Textarea } from "@/components/ui/form";
import { postMessage } from "@/lib/tickets/actions";
import { cn } from "@/lib/utils";

/** Reply box. Agents get a Reply / Internal note toggle. */
export function Composer({ ticketId, canNote = false, placeholder }: { ticketId: string; canNote?: boolean; placeholder?: string }) {
  const [internal, setInternal] = useState(false);
  const [fileCount, setFileCount] = useState(0);

  return (
    <ActionForm action={postMessage} onSuccess={() => setFileCount(0)} className={cn("rounded-xl border bg-white p-3", internal ? "border-amber-300 bg-amber-50/40" : "border-slate-200")}>
      <input type="hidden" name="ticket_id" value={ticketId} />
      <input type="hidden" name="internal" value={internal ? "on" : ""} />
      {canNote && (
        <div className="mb-2 flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setInternal(false)}
            className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium", !internal ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:bg-slate-100")}
          >
            <MessageSquare className="h-3.5 w-3.5" /> Reply to requester
          </button>
          <button
            type="button"
            onClick={() => setInternal(true)}
            className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium", internal ? "bg-amber-100 text-amber-800" : "text-slate-500 hover:bg-slate-100")}
          >
            <Lock className="h-3.5 w-3.5" /> Internal note
          </button>
        </div>
      )}
      <Textarea
        name="body"
        rows={4}
        maxLength={20000}
        placeholder={placeholder ?? (internal ? "Only agents can see this note…" : "Write a reply…")}
        aria-label={internal ? "Internal note" : "Reply"}
        className="border-0 bg-transparent px-1 shadow-none focus:ring-0"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
          <Paperclip className="h-3.5 w-3.5" />
          {fileCount ? `${fileCount} file${fileCount === 1 ? "" : "s"} attached` : "Attach files"}
          <input type="file" name="files" multiple className="sr-only" onChange={(e) => setFileCount(e.target.files?.length ?? 0)} />
        </label>
        <SubmitButton size="sm" variant={internal ? "secondary" : "primary"}>
          <Send className="h-3.5 w-3.5" /> {internal ? "Add note" : "Send"}
        </SubmitButton>
      </div>
      <p className="mt-1 px-1 text-[11px] text-slate-400">Markdown supported: **bold**, *italic*, `code`, lists and links. Up to 5 files, 4 MB in total.</p>
    </ActionForm>
  );
}
