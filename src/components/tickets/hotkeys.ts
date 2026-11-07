/**
 * True when a single-key shortcut should NOT fire: the user is typing, holds a
 * modifier (other than Shift), or a modal dialog is open.
 */
export function ignoreHotkey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return true;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return true;
  if (typeof document !== "undefined" && document.querySelector("dialog[open]")) return true;
  return false;
}

