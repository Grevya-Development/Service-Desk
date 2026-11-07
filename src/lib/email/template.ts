/** Notification email: short, branded, one clear button. Plain-text version included. */

export type NotificationEmailInput = {
  recipientName: string | null;
  title: string;
  body: string | null;
  /** Absolute URL to open, or null when there's nothing to link to. */
  url: string | null;
  /** Absolute URL of the desk (for the footer link). */
  deskUrl: string | null;
};

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only http(s) links make it into an email. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Strip the light markdown used in ticket text so previews read cleanly. */
function plain(s: string) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderNotificationEmail(input: NotificationEmailInput) {
  const first = (input.recipientName ?? "").trim().split(/\s+/)[0] || "there";
  const title = plain(input.title).slice(0, 200);
  const body = input.body ? plain(input.body).slice(0, 600) : "";
  const url = safeUrl(input.url);
  const deskUrl = safeUrl(input.deskUrl);
  const subject = title;

  const button = url
    ? `<tr><td style="padding:8px 0 4px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#2d48c8;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px">Open in Service Desk</a></td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#f4f6fa;font-family:Roboto,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(body || title)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #eef2f7;font-size:13px;font-weight:700;color:#0c1755;letter-spacing:.2px">Grevya Service Desk</td></tr>
<tr><td style="padding:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:14px;color:#475569;padding-bottom:8px">Hi ${escapeHtml(first)},</td></tr>
<tr><td style="font-size:18px;font-weight:700;color:#0f172a;padding-bottom:8px;line-height:1.35">${escapeHtml(title)}</td></tr>
${body ? `<tr><td style="font-size:14px;line-height:1.6;color:#334155;padding-bottom:16px">${escapeHtml(body)}</td></tr>` : ""}
${button}
</table>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eef2f7;font-size:12px;line-height:1.5;color:#64748b">
You're getting this because of activity on your Service Desk requests or work.
Turn these emails off any time from your account menu${deskUrl ? ` in the <a href="${escapeHtml(deskUrl)}" style="color:#2d48c8">Service Desk</a>` : ""}.
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [`Hi ${first},`, "", title, ...(body ? ["", body] : []), ...(url ? ["", `Open in Service Desk: ${url}`] : []), "", "—", "Grevya Service Desk. Turn these emails off from your account menu in the Service Desk."].join("\n");

  return { subject, html, text };
}
