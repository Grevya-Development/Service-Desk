"use client";

import { useId, useState } from "react";
import { RotateCcw, ThumbsDown, ThumbsUp, XCircle } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog, useDialog } from "@/components/ui/dialog";
import { Button, Label, Textarea } from "@/components/ui";
import { rateTicket, setOwnTicketStatus } from "@/lib/tickets/actions";
import { cn } from "@/lib/utils";

function CancelButton() {
  const dialog = useDialog();
  return (
    <Button variant="ghost" onClick={() => dialog?.close()}>
      Cancel
    </Button>
  );
}

/** "Still broken? Reopen" with a required reason. */
export function ReopenButton({ ticketId, deadline, className }: { ticketId: string; deadline?: string | null; className?: string }) {
  const id = useId();
  return (
    <Dialog
      title="Still not fixed?"
      description={deadline ? `You can reopen this until ${deadline}.` : undefined}
      size="md"
      trigger={
        <Button variant="outline" className={className}>
          <RotateCcw className="h-4 w-4" /> Still broken? Reopen
        </Button>
      }
    >
      <ActionForm action={setOwnTicketStatus} className="space-y-4">
        <input type="hidden" name="ticket_id" value={ticketId} />
        <input type="hidden" name="action" value="reopen" />
        <div>
          <Label htmlFor={`${id}-reason`} required>
            What&apos;s still wrong?
          </Label>
          <Textarea id={`${id}-reason`} name="reason" rows={4} required maxLength={5000} autoFocus placeholder="e.g. It worked for a day, but the error is back this morning." />
          <p className="mt-1 text-xs text-slate-500">This is added to the conversation so the team can pick it up again.</p>
        </div>
        <div className="flex justify-end gap-2">
          <CancelButton />
          <SubmitButton>
            <RotateCcw className="h-4 w-4" /> Reopen request
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/** "Close request" with an optional reason. */
export function CloseRequestButton({ ticketId, className }: { ticketId: string; className?: string }) {
  const id = useId();
  return (
    <Dialog
      title="Close this request?"
      description="Close it if you no longer need help, for example if the problem went away on its own."
      size="md"
      trigger={
        <Button variant="outline" className={className}>
          <XCircle className="h-4 w-4" /> Close request
        </Button>
      }
    >
      <ActionForm action={setOwnTicketStatus} className="space-y-4">
        <input type="hidden" name="ticket_id" value={ticketId} />
        <input type="hidden" name="action" value="close" />
        <div>
          <Label htmlFor={`${id}-reason`}>Reason (optional)</Label>
          <Textarea id={`${id}-reason`} name="reason" rows={3} maxLength={5000} placeholder="e.g. It started working again after a restart." />
        </div>
        <div className="flex justify-end gap-2">
          <CancelButton />
          <SubmitButton variant="danger">Close request</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/** Thumbs up / down + optional comment, once per ticket. */
export function RatingWidget({ ticketId }: { ticketId: string }) {
  const id = useId();
  const [rating, setRating] = useState<"good" | "bad" | null>(null);
  const options = [
    { value: "good" as const, label: "Yes, I'm happy", Icon: ThumbsUp, on: "border-emerald-400 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-200" },
    { value: "bad" as const, label: "Not really", Icon: ThumbsDown, on: "border-red-300 bg-red-50 text-red-800 ring-2 ring-red-100" },
  ];
  return (
    <ActionForm action={rateTicket} resetOnSuccess={false} className="space-y-3">
      <input type="hidden" name="ticket_id" value={ticketId} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-800">How did we do?</legend>
        <div className="grid grid-cols-2 gap-2">
          {options.map(({ value, label, Icon, on }) => (
            <label key={value} className="cursor-pointer">
              <input type="radio" name="rating" value={value} className="peer sr-only" checked={rating === value} onChange={() => setRating(value)} />
              <span
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-primary-500",
                  rating === value && on,
                )}
              >
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {rating && (
        <div>
          <Label htmlFor={`${id}-comment`}>{rating === "good" ? "Anything you'd like to add? (optional)" : "What could we have done better? (optional)"}</Label>
          <Textarea id={`${id}-comment`} name="comment" rows={2} maxLength={1000} />
        </div>
      )}
      <SubmitButton size="sm" disabled={!rating}>
        Send feedback
      </SubmitButton>
    </ActionForm>
  );
}
