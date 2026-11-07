import { emailConfig } from "./config";

export type OutgoingEmail = { to: string; subject: string; html: string; text: string; tags?: { name: string; value: string }[] };

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; /** worth retrying later (rate limit, outage, network) */ retryable: boolean; retryAfterSec?: number };

type Cfg = ReturnType<typeof emailConfig>;

function payload(e: OutgoingEmail, cfg: Cfg) {
  return { from: cfg.from, to: [e.to], subject: e.subject, html: e.html, text: e.text, ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}), ...(e.tags ? { tags: e.tags } : {}) };
}

async function post(path: string, body: unknown, idempotencyKey: string, cfg: Cfg, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${cfg.apiBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.slice(0, 256) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { res, json: json as { data?: { id?: string }[] | { id?: string }; id?: string; message?: string; name?: string } | null };
}

function failure(res: Response, json: { message?: string; name?: string } | null): Extract<SendResult, { ok: false }> {
  const retryAfter = Number(res.headers.get("retry-after"));
  const retryable = res.status === 429 || res.status >= 500 || res.status === 409;
  return {
    ok: false,
    retryable,
    retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    error: `${res.status} ${json?.name ?? ""} ${json?.message ?? ""}`.trim().slice(0, 300),
  };
}

/** Send one email. */
export async function sendEmail(e: OutgoingEmail, idempotencyKey: string, fetchImpl: typeof fetch = fetch, cfg: Cfg = emailConfig()): Promise<SendResult> {
  if (!cfg.configured) return { ok: false, retryable: true, error: "RESEND_API_KEY is not set" };
  try {
    const { res, json } = await post("/emails", payload(e, cfg), idempotencyKey, cfg, fetchImpl);
    if (!res.ok) return failure(res, json);
    const id = (json && !Array.isArray(json.data) && (json.data?.id ?? json.id)) || null;
    return { ok: true, id: id ?? null };
  } catch (err) {
    return { ok: false, retryable: true, error: err instanceof Error ? err.message : "Network error" };
  }
}

/**
 * Send up to 100 emails in one request. If Resend rejects the whole batch as invalid
 * (4xx other than rate limit), fall back to one-by-one so a single bad address doesn't
 * block everyone else. Results line up with the input order.
 */
export async function sendBatch(emails: OutgoingEmail[], idempotencyKey: string, fetchImpl: typeof fetch = fetch, cfg: Cfg = emailConfig()): Promise<SendResult[]> {
  if (!emails.length) return [];
  if (!cfg.configured) return emails.map(() => ({ ok: false as const, retryable: true, error: "RESEND_API_KEY is not set" }));
  if (emails.length === 1) return [await sendEmail(emails[0], idempotencyKey, fetchImpl, cfg)];
  try {
    const { res, json } = await post("/emails/batch", emails.map((e) => payload(e, cfg)), idempotencyKey, cfg, fetchImpl);
    if (res.ok) {
      const data = Array.isArray(json?.data) ? json!.data : [];
      return emails.map((_, i) => ({ ok: true as const, id: (data[i] as { id?: string } | undefined)?.id ?? null }));
    }
    const f = failure(res, json);
    if (f.retryable) return emails.map(() => f);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return emails.map(() => ({ ok: false as const, retryable: true, error: msg }));
  }
  const out: SendResult[] = [];
  for (let i = 0; i < emails.length; i++) out.push(await sendEmail(emails[i], `${idempotencyKey}:${i}`, fetchImpl, cfg));
  return out;
}
