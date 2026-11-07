"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { voteHelpful } from "../actions";

type Vote = boolean | null;

/** "Was this helpful?" yes / no. Agents also see the running totals. */
export function HelpfulVote({
  articleId,
  initialVote,
  initialCounts,
  reportHref,
}: {
  articleId: string;
  initialVote: Vote;
  /** Present only for agents (kb_feedback is readable by agents). */
  initialCounts: { yes: number; no: number } | null;
  reportHref: string;
}) {
  const [vote, setVote] = useState<Vote>(initialVote);
  const [justVoted, setJustVoted] = useState(false);
  const [pending, startTransition] = useTransition();

  // Totals excluding my original vote, so changing my mind moves the numbers correctly.
  const base = initialCounts && {
    yes: initialCounts.yes - (initialVote === true ? 1 : 0),
    no: initialCounts.no - (initialVote === false ? 1 : 0),
  };
  const counts = base && { yes: base.yes + (vote === true ? 1 : 0), no: base.no + (vote === false ? 1 : 0) };

  const cast = (helpful: boolean) => {
    if (pending) return;
    const previous = vote;
    setVote(helpful);
    const fd = new FormData();
    fd.set("article_id", articleId);
    fd.set("helpful", helpful ? "yes" : "no");
    startTransition(async () => {
      const res = await voteHelpful(null, fd);
      if (res?.ok) {
        setJustVoted(true);
      } else {
        setVote(previous);
        toast.error(res?.error ?? "Couldn't save your answer. Please try again.");
      }
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p id="helpful-q" className="text-sm font-semibold text-slate-800">
            Was this article helpful?
          </p>
          <p className="mt-0.5 text-xs text-slate-500" aria-live="polite">
            {vote === null ? "Your answer helps us improve our articles." : justVoted ? "Thanks for letting us know!" : "Thanks, you've already answered. You can change it."}
          </p>
        </div>
        <div role="group" aria-labelledby="helpful-q" className="flex gap-2">
          <VoteButton active={vote === true} disabled={pending} onClick={() => cast(true)} label="Yes" tone="yes" />
          <VoteButton active={vote === false} disabled={pending} onClick={() => cast(false)} label="No" tone="no" />
          {pending && <Loader2 className="h-4 w-4 animate-spin self-center text-slate-400" aria-label="Saving" />}
        </div>
      </div>

      {counts && (
        <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">
          <span className="font-medium text-emerald-700">{counts.yes}</span> {counts.yes === 1 ? "person" : "people"} found this helpful ·{" "}
          <span className="font-medium text-red-700">{counts.no}</span> didn&apos;t
          <span className="ml-1 text-slate-400">(visible to agents only)</span>
        </p>
      )}

      {vote === false && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg bg-white p-4 ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">Sorry this didn&apos;t solve it. Tell us what&apos;s going on and our team will help you.</p>
          <Link href={reportHref} className={buttonClass("primary", "sm", "shrink-0")}>
            Report an issue
          </Link>
        </div>
      )}
    </div>
  );
}

function VoteButton({ active, disabled, onClick, label, tone }: { active: boolean; disabled: boolean; onClick: () => void; label: string; tone: "yes" | "no" }) {
  const Icon = tone === "yes" ? ThumbsUp : ThumbsDown;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60",
        active
          ? tone === "yes"
            ? "bg-emerald-600 text-white ring-emerald-600"
            : "bg-red-600 text-white ring-red-600"
          : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
