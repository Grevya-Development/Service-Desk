"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/actions";
import { Button, type ButtonVariant, type ButtonSize } from "./button";
import { Dialog } from "./dialog";
import { Textarea, Label } from "./form";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * One-click mutation button, e.g. Approve / Reject / Cancel / Delete.
 *  - `fields` become FormData entries (e.g. { id }).
 *  - `confirm` shows a confirm dialog first.
 *  - `prompt` asks for a remark (sent as "remarks").
 */
export function ActionButton({
  action,
  fields = {},
  children,
  variant = "outline",
  size = "sm",
  className,
  confirm,
  prompt,
  promptRequired = false,
  successMessage,
  disabled,
  title,
}: {
  action: Action;
  fields?: Record<string, string | number | boolean | null | undefined>;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  confirm?: string;
  prompt?: string;
  promptRequired?: boolean;
  successMessage?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [remarks, setRemarks] = useState("");
  const router = useRouter();

  const run = (extra?: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...fields, ...extra })) {
      if (v !== null && v !== undefined) fd.set(k, String(v));
    }
    startTransition(async () => {
      const res = await action(null, fd);
      if (res?.ok) {
        toast.success(res.message ?? successMessage ?? "Done");
        setOpen(false);
        setRemarks("");
        if (res.redirectTo) router.push(res.redirectTo);
      } else if (res?.error) {
        toast.error(res.error);
      }
    });
  };

  const needsDialog = Boolean(confirm || prompt);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={pending || disabled}
        title={title}
        onClick={() => (needsDialog ? setOpen(true) : run())}
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {children}
      </Button>
      {needsDialog && (
        <Dialog open={open} onOpenChange={setOpen} title={confirm ?? "Add remarks"} size="sm">
          {prompt && (
            <div className="mb-4">
              <Label required={promptRequired}>{prompt}</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} autoFocus />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={variant === "outline" || variant === "ghost" ? "primary" : variant}
              disabled={pending || (promptRequired && !remarks.trim())}
              onClick={() => run(prompt ? { remarks } : undefined)}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
