/**
 * A same-origin path to send someone to after signing in, or the fallback.
 * Rejects absolute URLs and anything a browser would read as protocol-relative
 * ("//host", "/\host"), plus control characters.
 */
export function safeNext(next: string | null | undefined, fallback = "/home"): string {
  if (!next || !next.startsWith("/") || next.length > 512) return fallback;
  if (next[1] === "/" || next[1] === "\\") return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  return next;
}
