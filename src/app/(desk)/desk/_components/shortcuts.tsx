"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { ignoreHotkey } from "@/components/tickets/hotkeys";

export type Shortcut = { keys: string[]; label: string };

export const QUEUE_SHORTCUTS: Shortcut[] = [
  { keys: ["j"], label: "Next ticket" },
  { keys: ["k"], label: "Previous ticket" },
  { keys: ["Enter"], label: "Open the highlighted ticket" },
  { keys: ["x"], label: "Select / unselect the highlighted ticket" },
  { keys: ["?"], label: "Show these shortcuts" },
];

export const TICKET_SHORTCUTS: Shortcut[] = [
  { keys: ["r"], label: "Reply to the requester" },
  { keys: ["n"], label: "Write an internal note" },
  { keys: ["a"], label: "Assign to me" },
  { keys: ["Shift", "E"], label: "Resolve" },
  { keys: ["Ctrl", "Enter"], label: "Send the reply or note" },
  { keys: ["?"], label: "Show these shortcuts" },
];

/**
 * Single-key shortcuts. Handlers get the event; they never run while typing in a
 * field, with Ctrl/Cmd/Alt held, or while a dialog is open.
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignoreHotkey(e)) return;
      const key = e.shiftKey && e.key.length === 1 && e.key !== "?" ? `Shift+${e.key.toUpperCase()}` : e.key;
      const fn = ref.current[key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Click the button inside `[data-shortcut=name]` (used to trigger existing action buttons). */
export function clickShortcut(name: string) {
  const el = document.querySelector<HTMLButtonElement>(`[data-shortcut="${name}"] button`);
  if (el && !el.disabled) {
    el.click();
    return true;
  }
  return false;
}

/** "?" opens a help dialog listing the page's shortcuts; also has a small keyboard button. */
export function ShortcutsHelp({ shortcuts, extra }: { shortcuts: Shortcut[]; extra?: Record<string, (e: KeyboardEvent) => void> }) {
  const [open, setOpen] = useState(false);
  useHotkeys({ ...extra, "?": () => setOpen(true) });
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:inline-flex"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
      >
        <Keyboard className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" description="Shortcuts don't work while you're typing in a box." size="sm">
        <dl className="space-y-2 text-sm">
          {shortcuts.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4">
              <dt className="text-slate-600">{s.label}</dt>
              <dd className="flex shrink-0 gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="min-w-[1.5rem] rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-center font-mono text-xs text-slate-700 shadow-[0_1px_0_rgb(203_213_225)]">
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </>
  );
}
