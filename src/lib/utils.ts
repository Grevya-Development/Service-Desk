import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO, isValid } from "date-fns";

/** Join class names; later Tailwind classes override conflicting earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type DateInput = string | Date | null | undefined;

const IST_OFFSET_MIN = 330;

/**
 * Shift an instant so its *local* fields read as India time. date-fns formats
 * with the runtime's time zone, which differs between servers (often UTC) and
 * browsers; anchoring to IST keeps server and client output identical and
 * shows the correct time for Grevya everywhere.
 */
function asIndiaWallClock(date: Date): Date {
  return new Date(date.getTime() + (IST_OFFSET_MIN + date.getTimezoneOffset()) * 60000);
}

function toDate(d: DateInput): Date | null {
  if (!d) return null;
  // Plain dates ("2026-10-27") are calendar days, not instants: keep them as-is.
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const day = parseISO(d);
    return isValid(day) ? day : null;
  }
  const date = typeof d === "string" ? parseISO(d) : d;
  return isValid(date) ? asIndiaWallClock(date) : null;
}

/** 27 Oct 2026 */
export function formatDate(d: DateInput, pattern = "dd MMM yyyy") {
  const date = toDate(d);
  return date ? format(date, pattern) : "—";
}

/** 27 Oct 2026, 09:30 AM */
export function formatDateTime(d: DateInput) {
  return formatDate(d, "dd MMM yyyy, hh:mm a");
}

/** 09:30 AM */
export function formatTime(d: DateInput) {
  return formatDate(d, "hh:mm a");
}

/** ₹1,23,456 (Indian grouping). Pass decimals=2 for paise. */
export function formatCurrency(amount: number | string | null | undefined, decimals = 0) {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(n) ? n : 0);
}

export function formatNumber(n: number | string | null | undefined, decimals = 0) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: decimals }).format(Number(n ?? 0));
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** "pending_manager" -> "Pending Manager" */
export function humanize(s: string | null | undefined) {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Today's date in India (yyyy-MM-dd) — matches public.org_today() in the DB. */
export function orgToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** Indian financial year label for a date, e.g. "2026-27". */
export function financialYear(d: DateInput = new Date()) {
  const date = toDate(d) ?? new Date();
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function greeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(date));
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

/** Read a trimmed string from FormData ("" -> null). */
/**
 * Indian mobile number: exactly 10 digits starting 6–9, optionally prefixed
 * with +91 / 91 / 0; spaces and dashes allowed. Use as an <input pattern>.
 */
export const MOBILE_PATTERN = String.raw`(\+?91|0)?[\s\-]*[6-9]([\s\-]*[0-9]){9}`;
export const MOBILE_HINT = "Enter a 10-digit mobile number, e.g. +91 98765 43210";

/** Normalises a valid mobile number to "+91 9876543210"; null when invalid. */
export function normalizeMobile(value: string): string | null {
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(value.replace(/[\s-]/g, ""));
  return m ? `+91 ${m[1]}` : null;
}

export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function num(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}
