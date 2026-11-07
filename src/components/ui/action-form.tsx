"use client";

import { createContext, useContext, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/actions";
import { Button, type ButtonVariant, type ButtonSize } from "./button";
import { useDialog } from "./dialog";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * Form wired to a server action `(prev, formData) => ActionState`.
 * Shows a toast on success/error, keeps input on error, resets on success,
 * follows `redirectTo`, and closes the surrounding <Dialog> on success.
 * The result is handled right after the action returns, so it still works
 * when the action's revalidation replaces or unmounts this form.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess = true,
  onSuccess,
  id,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (state: ActionState) => void;
  id?: string;
}) {
  const router = useRouter();
  const dialog = useDialog();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <PendingContext.Provider value={pending}>
      <form
        id={id}
        ref={formRef}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          // Include the clicked submit button's name/value (e.g. intent=draft|submit).
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          const fd = submitter?.name ? new FormData(form, submitter) : new FormData(form);
          startTransition(async () => {
            let state: ActionState;
            try {
              state = await action(null, fd);
            } catch (err) {
              toast.error(err instanceof Error && err.message ? err.message : "Something went wrong");
              return;
            }
            if (!state) return;
            if (state.ok) {
              toast.success(state.message ?? successMessage ?? "Saved successfully");
              if (resetOnSuccess) formRef.current?.reset();
              dialog?.close();
              onSuccess?.(state);
              if (state.redirectTo) router.push(state.redirectTo);
            } else if (state.error) {
              toast.error(state.error);
            }
          });
        }}
      >
        {children}
      </form>
    </PendingContext.Provider>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
  disabled,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const pending = useContext(PendingContext);
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending || disabled} name={name} value={value}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}
