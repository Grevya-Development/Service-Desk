/** Placeholders the reply box fills in when an agent inserts a template. */
export const PLACEHOLDERS = [
  { token: "{{first_name}}", label: "Requester's first name", sample: "Priya" },
  { token: "{{ticket}}", label: "Ticket number", sample: "SD-1234" },
  { token: "{{agent_name}}", label: "Your name", sample: "" },
] as const;

const KNOWN = new Set<string>(PLACEHOLDERS.map((p) => p.token));

/** Any {{…}} in the text that the reply box won't recognise, e.g. "{{name}}". */
export function unknownPlaceholders(text: string) {
  const found = text.match(/\{\{\s*[^{}]*\s*\}\}/g) ?? [];
  return [...new Set(found.filter((t) => !KNOWN.has(t)))];
}

/** Replace placeholders with example values for previews. */
export function fillSample(text: string, agentName: string) {
  return text.replaceAll("{{first_name}}", "Priya").replaceAll("{{ticket}}", "SD-1234").replaceAll("{{agent_name}}", agentName);
}

export const TITLE_MAX = 80;
export const BODY_MAX = 5000;

export const STARTERS = [
  {
    key: "details",
    title: "Need more details",
    body: [
      "Hi {{first_name}},",
      "",
      "Thanks for getting in touch about {{ticket}}. To help you faster, could you tell us:",
      "",
      "- What you were trying to do",
      "- What happened instead (a screenshot helps)",
      "- When it started",
      "",
      "Thanks,",
      "{{agent_name}}",
    ].join("\n"),
  },
  {
    key: "restart",
    title: "Restart and try again",
    body: [
      "Hi {{first_name}},",
      "",
      "Could you try these steps and let us know if it helps?",
      "",
      "1. Save your work and restart your laptop",
      "2. Sign in again and try once more",
      "",
      "If it still doesn't work, just reply here and we'll take it from there.",
      "",
      "{{agent_name}}",
    ].join("\n"),
  },
  {
    key: "fixed",
    title: "Fixed — please confirm",
    body: [
      "Hi {{first_name}},",
      "",
      "Good news: we've fixed the problem in {{ticket}}. Could you check and confirm it's working for you?",
      "",
      "If anything still isn't right, reply here and we'll pick it up again.",
      "",
      "Thanks,",
      "{{agent_name}}",
    ].join("\n"),
  },
] as const;

export type StarterKey = (typeof STARTERS)[number]["key"];

/** Plain-text excerpt that keeps {{placeholders}} intact (the shared excerpt() treats "_" as italics). */
export function plainExcerpt(source: string, max = 160) {
  const text = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*]\s+|\d+\.\s+)/gm, "")
    .replace(/\*\*|`/g, "")
    .replace(/(^|\s)\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
