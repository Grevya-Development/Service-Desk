"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Eye, PencilLine, Trash2 } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ActionButton } from "@/components/ui/action-button";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import {
  ARTICLE_STATUS_LABELS,
  ARTICLE_STATUSES,
  BODY_MAX,
  parseTags,
  safeColor,
  slugify,
  SLUG_MAX,
  SLUG_RE,
  SUMMARY_MAX,
  TAG_MAX_LENGTH,
  TAGS_MAX,
  TITLE_MAX,
  TITLE_MIN,
  VISIBILITIES,
  VISIBILITY_LABELS,
  type ArticleStatus,
  type Visibility,
} from "../../../kb/_lib/article";
import { deleteArticle, saveArticle } from "../actions";

export type EditorTeam = { id: string; name: string; color: string };
export type EditorCategory = { id: string; name: string; team_id: string };
export type EditorArticle = {
  id: string;
  team_id: string;
  category_id: string | null;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  tags: string[];
  visibility: Visibility;
  status: ArticleStatus;
};

const STATUS_HINTS: Record<ArticleStatus, string> = {
  draft: "Only agents of this team can see drafts.",
  published: "Shows in the help center and in suggestions while people report issues.",
  archived: "Hidden from the help center. Agents of this team can still open it.",
};

const VISIBILITY_HINTS: Record<Visibility, string> = {
  everyone: "Every employee can read it once published.",
  agents: "Only agents (of any team) can read it. Good for internal how-tos.",
};

export function ArticleEditor({
  article,
  teams,
  categories,
  defaultTeamId,
  canDelete = false,
}: {
  article: EditorArticle | null;
  teams: EditorTeam[];
  categories: EditorCategory[];
  defaultTeamId?: string | null;
  canDelete?: boolean;
}) {
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    slug: `${uid}-slug`,
    summary: `${uid}-summary`,
    body: `${uid}-body`,
    team: `${uid}-team`,
    category: `${uid}-category`,
    status: `${uid}-status`,
    visibility: `${uid}-visibility`,
    tags: `${uid}-tags`,
  };

  const [teamId, setTeamId] = useState(article?.team_id ?? (defaultTeamId && teams.some((t) => t.id === defaultTeamId) ? defaultTeamId : (teams[0]?.id ?? "")));
  const [categoryId, setCategoryId] = useState(article?.category_id ?? "");
  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  // New articles follow the title until the slug is edited by hand; existing ones keep their URL.
  const [slugTouched, setSlugTouched] = useState(Boolean(article));
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [tags, setTags] = useState(article?.tags.join(", ") ?? "");
  const [visibility, setVisibility] = useState<Visibility>(article?.visibility ?? "everyone");
  const [status, setStatus] = useState<ArticleStatus>(article?.status ?? "draft");
  const [tab, setTab] = useState<"write" | "preview">("write");

  const team = teams.find((t) => t.id === teamId);
  const teamCategories = categories.filter((c) => c.team_id === teamId);
  const slugError = slug && !SLUG_RE.test(slug) ? "Use lowercase letters, numbers and single dashes only (e.g. reset-vpn-password)." : null;
  const tagList = parseTags(tags);
  const tagError = tagList.length > TAGS_MAX ? `Use at most ${TAGS_MAX} tags.` : tagList.some((t) => t.length > TAG_MAX_LENGTH) ? `Keep each tag under ${TAG_MAX_LENGTH} characters.` : null;
  const slugChangedOnPublished = article?.status === "published" && slug !== article.slug;

  const submitLabel =
    status === "published" ? (article?.status === "published" ? "Save changes" : "Publish article") : status === "draft" ? "Save draft" : "Save as archived";

  return (
    <ActionForm action={saveArticle} resetOnSuccess={false} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {article && <input type="hidden" name="id" value={article.id} />}

      {/* Main column: content */}
      <Card className="min-w-0">
        <div className="space-y-5 px-5 py-5">
          <Field label="Title" htmlFor={ids.title} required hint="Phrase it the way people would ask, e.g. “How do I connect to the VPN?”">
            <Input
              id={ids.title}
              name="title"
              value={title}
              required
              minLength={TITLE_MIN}
              maxLength={TITLE_MAX}
              placeholder="How do I…?"
              className="h-10 text-base font-medium"
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </Field>

          <Field
            label="Web address"
            htmlFor={ids.slug}
            required
            hint={
              slugError ? (
                <span className="text-red-600">{slugError}</span>
              ) : slugChangedOnPublished ? (
                <span className="text-amber-700">Changing the address of a published article breaks links people have saved.</span>
              ) : slugTouched ? (
                "Lowercase letters, numbers and dashes."
              ) : (
                "Filled in from the title. You can change it."
              )
            }
          >
            <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/20">
              <span className="hidden items-center border-r border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 sm:flex">/kb/</span>
              <input
                id={ids.slug}
                name="slug"
                value={slug}
                required
                maxLength={SLUG_MAX}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Lowercase letters, numbers and single dashes only"
                aria-invalid={slugError ? true : undefined}
                spellCheck={false}
                autoCapitalize="off"
                placeholder="how-do-i-connect-to-the-vpn"
                className="h-9 min-w-0 flex-1 border-0 bg-transparent px-3 font-mono text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
                onChange={(e) => {
                  const v = e.target.value.toLowerCase().replace(/\s+/g, "-");
                  setSlug(v);
                  setSlugTouched(v !== "");
                }}
                onBlur={() => {
                  // Left empty: go back to following the title.
                  if (!slug) setSlug(slugify(title));
                }}
              />
            </div>
          </Field>

          <Field
            label="Summary"
            htmlFor={ids.summary}
            hint={
              <span className="flex justify-between gap-2">
                <span>One or two sentences shown in search results and at the top of the article.</span>
                <span className={cn("shrink-0 tabular-nums", summary.length > SUMMARY_MAX - 20 && "text-amber-700")}>
                  {summary.length}/{SUMMARY_MAX}
                </span>
              </span>
            }
          >
            <Textarea id={ids.summary} name="summary" rows={2} maxLength={SUMMARY_MAX} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>

          <div>
            <div className="mb-1.5 flex items-end justify-between gap-2">
              <label htmlFor={ids.body} className="block text-xs font-medium text-slate-600">
                Article
              </label>
              <div role="tablist" aria-label="Article editor mode" className="inline-flex rounded-lg bg-slate-100 p-0.5">
                <TabButton active={tab === "write"} onClick={() => setTab("write")} icon={<PencilLine className="h-3.5 w-3.5" aria-hidden />} label="Write" controls={`${uid}-write`} />
                <TabButton active={tab === "preview"} onClick={() => setTab("preview")} icon={<Eye className="h-3.5 w-3.5" aria-hidden />} label="Preview" controls={`${uid}-preview`} />
              </div>
            </div>
            <div id={`${uid}-write`} role="tabpanel" hidden={tab !== "write"}>
              <Textarea
                id={ids.body}
                name="body"
                rows={20}
                maxLength={BODY_MAX}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={"Explain the fix step by step.\n\n## Steps\n1. Open Settings\n2. Click **Network**\n\n> Tip: restart your laptop if it still doesn't work."}
                className="min-h-[24rem] font-mono text-[13px] leading-6"
              />
            </div>
            <div id={`${uid}-preview`} role="tabpanel" hidden={tab !== "preview"} className="min-h-[24rem] rounded-lg border border-slate-200 bg-white px-5 py-4">
              {summary.trim() && <p className="mb-3 text-base leading-relaxed text-slate-600">{summary}</p>}
              {body.trim() ? (
                <Markdown source={body} className="prose-doc max-w-[72ch] text-[15px] leading-7" />
              ) : (
                <p className="text-sm italic text-slate-400">Nothing to preview yet. Write something first.</p>
              )}
            </div>
            <details className="mt-2 text-xs text-slate-500">
              <summary className="cursor-pointer select-none font-medium text-slate-600 hover:text-slate-800">Formatting help</summary>
              <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                <li><code className="text-slate-700"># Heading</code>, <code className="text-slate-700">## Sub-heading</code></li>
                <li><code className="text-slate-700">**bold**</code>, <code className="text-slate-700">*italic*</code>, <code className="text-slate-700">`code`</code></li>
                <li><code className="text-slate-700">- item</code> for bullets, <code className="text-slate-700">1. step</code> for numbered steps</li>
                <li><code className="text-slate-700">[link text](https://…)</code> or <code className="text-slate-700">(/kb/other-article)</code></li>
                <li><code className="text-slate-700">&gt; Tip</code> for a highlighted note</li>
                <li><code className="text-slate-700">```</code> on its own line to start and end a code block</li>
              </ul>
            </details>
          </div>
        </div>
      </Card>

      {/* Side column: settings */}
      <div className="space-y-6">
        <Card>
          <CardHeader title="Publishing" />
          <div className="space-y-4 px-5 py-4">
            <Field label="Status" htmlFor={ids.status} hint={STATUS_HINTS[status]}>
              <Select id={ids.status} name="status" value={status} onChange={(e) => setStatus(e.target.value as ArticleStatus)}>
                {ARTICLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ARTICLE_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Who can read it" htmlFor={ids.visibility} hint={VISIBILITY_HINTS[visibility]}>
              <Select id={ids.visibility} name="visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                {VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
              <SubmitButton disabled={Boolean(slugError || tagError) || !teamId} className="w-full">
                {submitLabel}
              </SubmitButton>
              <Link href="/desk/kb" className={buttonClass("ghost", "md", "w-full")}>
                Cancel
              </Link>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <div className="space-y-4 px-5 py-4">
            <Field label="Team" htmlFor={ids.team} required>
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full" style={{ backgroundColor: safeColor(team?.color) }} />
                <Select
                  id={ids.team}
                  name="team_id"
                  value={teamId}
                  required
                  className="pl-7"
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    if (!categories.some((c) => c.id === categoryId && c.team_id === e.target.value)) setCategoryId("");
                  }}
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            <Field label="Category" htmlFor={ids.category} hint="Optional. Helps people browse.">
              <Select id={ids.category} name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={teamCategories.length === 0}>
                <option value="">{teamCategories.length ? "No category" : "This team has no categories"}</option>
                {teamCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Tags"
              htmlFor={ids.tags}
              hint={tagError ? <span className="text-red-600">{tagError}</span> : `Separate with commas. Up to ${TAGS_MAX}. Helps search find this article.`}
            >
              <Input id={ids.tags} name="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vpn, wifi, remote work" aria-invalid={tagError ? true : undefined} />
            </Field>
            {tagList.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Tags preview">
                {tagList.map((t) => (
                  <li key={t} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    #{t}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {article && canDelete && (
          <Card className="border-red-100">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-slate-800">Delete article</p>
                <p className="mt-0.5 text-xs text-slate-500">Removes it and its feedback for good. Archive instead to keep a copy.</p>
              </div>
              <ActionButton action={deleteArticle} fields={{ id: article.id }} variant="danger" confirm="Delete this article for good?">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete
              </ActionButton>
            </div>
          </Card>
        )}
      </div>
    </ActionForm>
  );
}

function TabButton({ active, onClick, icon, label, controls }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; controls: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
