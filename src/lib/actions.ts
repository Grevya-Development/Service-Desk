/** Shared return shape for server actions used with <ActionForm> / <ActionButton>. */
export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  /** Optional path to navigate to on success */
  redirectTo?: string;
} | null;

export const ok = (message?: string, redirectTo?: string): ActionState => ({ ok: true, message, redirectTo });
export const fail = (error: string): ActionState => ({ ok: false, error });

/** Turn a Supabase/Postgres error into a friendly message. */
export function dbError(error: { message: string; code?: string } | null | undefined, fallback = "Something went wrong") {
  if (!error) return fallback;
  if (error.code === "23505") return "This record already exists.";
  if (error.code === "42501" || /row-level security/i.test(error.message)) return "You don't have permission to do that.";
  return error.message || fallback;
}
