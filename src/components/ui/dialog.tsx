"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type DialogCtx = { close: () => void };
const Ctx = createContext<DialogCtx | null>(null);

/** Inside a <Dialog>, returns { close }. Outside, null. */
export function useDialog() {
  return useContext(Ctx);
}

/**
 * Modal dialog. `trigger` is any element (rendered inside a click wrapper).
 * Content can include <ActionForm>, which closes the dialog on success.
 */
export function Dialog({
  trigger,
  title,
  description,
  children,
  size = "md",
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = useCallback(
    (v: boolean) => {
      if (controlledOpen === undefined) setUncontrolled(v);
      onOpenChange?.(v);
    },
    [controlledOpen, onOpenChange],
  );

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

  return (
    <>
      {trigger && (
        <span className="contents" onClick={() => setOpen(true)}>
          {trigger}
        </span>
      )}
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false);
        }}
        className={cn(
          "m-auto w-[calc(100%-2rem)] rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-[1px]",
          widths[size],
        )}
      >
        {open && (
          <Ctx.Provider value={{ close: () => setOpen(false) }}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto px-5 py-4 thin-scroll">{children}</div>
          </Ctx.Provider>
        )}
      </dialog>
    </>
  );
}
