import { Fragment, type ReactNode } from "react";

/**
 * Safe markdown subset for knowledge-base articles and ticket text.
 * Supports: # / ## / ### headings, paragraphs, - / * bullet lists, 1. numbered
 * lists, > quotes, ``` code blocks, **bold**, *italic*, `code`, [links](url).
 * Never renders raw HTML. Links must be http(s), mailto or site-relative.
 */
export function Markdown({ source, className }: { source: string | null | undefined; className?: string }) {
  return <div className={className ?? "prose-doc text-sm"}>{renderBlocks(source ?? "")}</div>;
}

export function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  return null;
}

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*([^*\s][^*]*)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[2]) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[4]) out.push(<code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]">{m[4]}</code>);
    else if (m[6]) {
      const href = safeHref(m[7]);
      out.push(
        href ? (
          <a key={key} href={href} className="text-primary-600 underline" target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
            {m[6]}
          </a>
        ) : (
          <Fragment key={key}>{m[6]}</Fragment>
        ),
      );
    } else if (m[9]) out.push(<em key={key}>{m[9]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k++} className="my-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const content = renderInline(h[2], `h${k}`);
      blocks.push(h[1].length === 1 ? <h2 key={k++}>{content}</h2> : h[1].length === 2 ? <h3 key={k++}>{content}</h3> : <h4 key={k++} className="font-semibold">{content}</h4>);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      blocks.push(
        <ul key={k++}>
          {items.map((t, j) => (
            <li key={j}>{renderInline(t, `u${k}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(
        <ol key={k++}>
          {items.map((t, j) => (
            <li key={j}>{renderInline(t, `o${k}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={k++} className="my-3 border-l-4 border-primary-100 bg-primary-50/40 px-3 py-2 text-slate-600">
          {renderInline(quote.join(" "), `q${k}`)}
        </blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|```|>|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    if (para.length === 0) para.push(lines[i++]);
    blocks.push(
      <p key={k++}>
        {para.map((t, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(t, `p${k}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return blocks;
}

/** Plain-text excerpt of markdown (for cards and search results). */
export function excerpt(source: string | null | undefined, max = 160) {
  const text = (source ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*`_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
