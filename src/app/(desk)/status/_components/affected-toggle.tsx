"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BellRing, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { setAffected } from "../actions";

/** "I'm affected — notify me when it's fixed" switch. */
export function AffectedToggle({ incidentId, subscribed }: { incidentId: string; subscribed: boolean }) {
  const [pending, startTransition] = useTransition();
  // Plain state (not useOptimistic): an optimistic value snaps back to the old prop the moment the
  // action finishes if the refreshed page hasn't arrived yet. Revert only when saving fails.
  const [on, setOn] = useState(subscribed);
  const [prevProp, setPrevProp] = useState(subscribed);
  if (prevProp !== subscribed) {
    setPrevProp(subscribed);
    setOn(subscribed);
  }

  const toggle = () => {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("incident_id", incidentId);
      fd.set("on", next ? "1" : "0");
      let res;
      try {
        res = await setAffected(null, fd);
      } catch {
        res = { ok: false as const, error: "Something went wrong. Please try again." };
      }
      if (res?.ok) toast.success(res.message ?? "Saved");
      else {
        setOn(!next);
        toast.error(res?.error ?? "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      disabled={pending}
      className={cn(
        "group inline-flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-wait sm:w-auto",
        on ? "border-primary-200 bg-primary-50 text-primary-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      <span
        aria-hidden
        className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", on ? "bg-primary-600" : "bg-slate-300")}
      >
        <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-4.5" : "translate-x-0.5")} />
      </span>
      <span className="flex-1 font-medium">
        {on ? (
          <>
            <Check aria-hidden className="mr-1 inline h-4 w-4 -translate-y-px" />
            You&apos;ll be notified when it&apos;s fixed
          </>
        ) : (
          <>
            <BellRing aria-hidden className="mr-1 inline h-4 w-4 -translate-y-px" />
            I&apos;m affected — notify me when it&apos;s fixed
          </>
        )}
      </span>
      {pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin text-slate-400" />}
    </button>
  );
}
