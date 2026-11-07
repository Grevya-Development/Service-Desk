export const MAX_ATTEMPTS = 5;

/** Minutes to wait before retry n (1-based): 1, 5, 15, then 60 for every later attempt. */
export function backoffMinutes(attempt: number) {
  return [1, 5, 15, 60][Math.min(Math.max(attempt, 1), 4) - 1];
}
