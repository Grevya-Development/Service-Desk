/** Knowledge-base helpers shared by the help center (/kb) and article management (/desk/kb). Safe on server and client. */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const SLUG_MAX = 120;
export const TITLE_MIN = 3;
export const TITLE_MAX = 160;
export const SUMMARY_MAX = 300;
export const BODY_MAX = 100_000;
export const TAGS_MAX = 10;
export const TAG_MAX_LENGTH = 40;

export const ARTICLE_STATUSES = ["draft", "published", "archived"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = { draft: "Draft", published: "Published", archived: "Archived" };

export const VISIBILITIES = ["everyone", "agents"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABELS: Record<Visibility, string> = { everyone: "Everyone", agents: "Agents only" };

export function isArticleStatus(v: unknown): v is ArticleStatus {
  return typeof v === "string" && (ARTICLE_STATUSES as readonly string[]).includes(v);
}
export function isVisibility(v: unknown): v is Visibility {
  return typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v);
}

/** "How do I reset my VPN password?" -> "how-do-i-reset-my-vpn-password" */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** "VPN, Laptop ,vpn" -> ["vpn", "laptop"] (trimmed, lowercased, de-duplicated, order kept). */
export function parseTags(input: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const raw of (input ?? "").split(",")) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** Team colours are stored as #rrggbb; fall back to the brand blue for anything else. */
export function safeColor(color: string | null | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#2d48c8";
}

/** Share of "yes" votes as a whole percentage, or null when nobody has voted. */
export function helpfulPercent(yes: number, no: number): number | null {
  const total = yes + no;
  return total ? Math.round((yes / total) * 100) : null;
}
