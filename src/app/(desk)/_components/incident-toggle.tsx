"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BellRing, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { setIncidentAffected } from "./incident-actions";

/** "I'm affected — notify me" toggle with an optimistic state. */
export function IncidentToggle({ incidentId, initial, title }: { incidentId: string; initial: boolean; title: string }) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !on;
    setOn(next);
    const fd = new FormData();
    fd.set("incident_id", incidentId);
    fd.set("on", next ? "on" : "");
    startTransition(async () => {
      let res;
      try {
        res = await setIncidentAffected(null, fd);
      } catch {
        res = { ok: false, error: "Something went wrong. Please try again." };
      }
      if (res?.ok) toast.success(res.message);
      else {
        setOn(!next);
        toast.error(res?.error ?? "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={on}
      title={on ? `You'll be told when “${title}” is fixed. Click to stop.` : `Tell me when “${title}” is fixed`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-70",
        on ? "bg-emerald-50 text-emerald-800 ring-emerald-300 hover:bg-emerald-100" : "bg-white text-slate-800 ring-slate-300 hover:bg-slate-50",
      )}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : on ? <Check className="h-3.5 w-3.5" aria-hidden /> : <BellRing className="h-3.5 w-3.5" aria-hidden />}
      {on ? "We'll notify you" : "I'm affected — notify me"}
    </button>
  );
}
