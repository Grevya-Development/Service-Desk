const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-07" → "7 Nov" (no time-zone maths: it's already an India day). */
export const shortDay = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** 87.4 → "87%"; null → "—". */
export const pctText = (p: number | null) => (p === null ? "—" : `${Math.round(p)}%`);
