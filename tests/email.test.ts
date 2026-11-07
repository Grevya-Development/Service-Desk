import { describe, expect, it, vi } from "vitest";
import { escapeHtml, renderNotificationEmail, safeUrl } from "@/lib/email/template";
import { recipientAllowed } from "@/lib/email/config";
import { backoffMinutes } from "@/lib/email/retry";
import { sendBatch, sendEmail, type OutgoingEmail } from "@/lib/email/resend";

const cfg = {
  apiKey: "re_test",
  from: "Desk <desk@grevya.com>",
  replyTo: undefined,
  apiBase: "https://resend.test",
  configured: true,
  usingSandboxSender: false,
  allowAll: true,
  allowlist: [] as string[],
};
const mail = (to: string): OutgoingEmail => ({ to, subject: "S", html: "<p>h</p>", text: "t" });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("email template", () => {
  it("escapes HTML in titles and bodies", () => {
    const { html, text, subject } = renderNotificationEmail({
      recipientName: "Priya Nair",
      title: "Update on SD-1042 <script>",
      body: 'Click "here" & <b>now</b>',
      url: "https://desk.grevya.com/requests/1042",
      deskUrl: "https://desk.grevya.com",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;here&quot; &amp; &lt;b&gt;");
    expect(html).toContain('href="https://desk.grevya.com/requests/1042"');
    expect(html).toContain("Hi Priya,");
    expect(text).toContain("Open in Service Desk: https://desk.grevya.com/requests/1042");
    expect(subject).toBe("Update on SD-1042 <script>");
  });

  it("drops non-http links and strips markdown", () => {
    const { html } = renderNotificationEmail({ recipientName: null, title: "**Fixed**", body: "`code` and [a link](https://x.y)", url: "javascript:alert(1)", deskUrl: null });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Open in Service Desk");
    expect(html).toContain("Hi there,");
    expect(html).toContain(">Fixed<");
    expect(html).toContain("code and a link");
  });

  it("safeUrl only allows http(s)", () => {
    expect(safeUrl("https://a.b/c")).toBe("https://a.b/c");
    expect(safeUrl("mailto:x@y.z")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(escapeHtml(`<'">&`)).toBe("&lt;&#39;&quot;&gt;&amp;");
  });
});

describe("recipient allowlist (non-production)", () => {
  const dev = { ...cfg, allowAll: false, allowlist: ["kavin@grevya.com", "*@test.grevya.com"] };
  it("allows exact addresses and *@domain patterns only", () => {
    expect(recipientAllowed("Kavin@grevya.com", dev)).toBe(true);
    expect(recipientAllowed("a@test.grevya.com", dev)).toBe(true);
    expect(recipientAllowed("priya@grevya.com", dev)).toBe(false);
    expect(recipientAllowed("anyone@anywhere.com", { ...dev, allowAll: true })).toBe(true);
    expect(recipientAllowed("priya@grevya.com", { ...dev, allowlist: [] })).toBe(false);
  });
});

describe("retry backoff", () => {
  it("waits 1, 5, 15, then 60 minutes", () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMinutes)).toEqual([1, 5, 15, 60, 60, 60]);
  });
});

describe("Resend client", () => {
  it("sends a batch with auth, idempotency key and lines results up by index", async () => {
    const fetchMock = vi.fn(async () => json(200, { data: [{ id: "a" }, { id: "b" }] }));
    const res = await sendBatch([mail("x@grevya.com"), mail("y@grevya.com")], "key-1", fetchMock as unknown as typeof fetch, cfg);
    expect(res).toEqual([{ ok: true, id: "a" }, { ok: true, id: "b" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://resend.test/emails/batch");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Idempotency-Key"]).toBe("key-1");
    const body = JSON.parse(String(init.body));
    expect(body[0]).toMatchObject({ from: "Desk <desk@grevya.com>", to: ["x@grevya.com"], subject: "S" });
  });

  it("falls back to one-by-one when the whole batch is rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(422, { name: "validation_error", message: "Invalid `to` field" }))
      .mockResolvedValueOnce(json(200, { id: "ok-1" }))
      .mockResolvedValueOnce(json(422, { name: "validation_error", message: "bad address" }));
    const res = await sendBatch([mail("good@grevya.com"), mail("bad")], "key-2", fetchMock as unknown as typeof fetch, cfg);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res[0]).toEqual({ ok: true, id: "ok-1" });
    expect(res[1]).toMatchObject({ ok: false, retryable: false });
  });

  it("marks rate limits and outages as retryable with retry-after", async () => {
    const fetchMock = vi.fn(async () => json(429, { name: "rate_limit_exceeded", message: "Too many requests" }, { "retry-after": "2" }));
    const res = await sendBatch([mail("a@grevya.com"), mail("b@grevya.com")], "key-3", fetchMock as unknown as typeof fetch, cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res[0]).toMatchObject({ ok: false, retryable: true, retryAfterSec: 2 });
  });

  it("treats network errors as retryable and refuses to send without a key", async () => {
    const boom = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await sendEmail(mail("a@grevya.com"), "k", boom as unknown as typeof fetch, cfg)).toMatchObject({ ok: false, retryable: true, error: "ECONNRESET" });
    expect(await sendEmail(mail("a@grevya.com"), "k", boom as unknown as typeof fetch, { ...cfg, apiKey: "", configured: false })).toMatchObject({ ok: false, retryable: true });
    expect(boom).toHaveBeenCalledTimes(1);
  });
});
