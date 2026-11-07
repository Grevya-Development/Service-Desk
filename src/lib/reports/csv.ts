/** Tiny RFC 4180 CSV writer for exports (pure; unit tested). */

export type CsvValue = string | number | boolean | null | undefined;

/**
 * One CSV cell: quoted when it holds a comma, quote, newline or edge spaces.
 * Text starting with = + - @ (or a tab / carriage return) is prefixed with an
 * apostrophe so spreadsheet apps don't run it as a formula.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row + data rows, CRLF line endings (what Excel expects). */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
