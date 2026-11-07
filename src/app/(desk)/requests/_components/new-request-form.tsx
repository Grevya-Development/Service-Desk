"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Check, Lightbulb, Paperclip, Send, X } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, Field, Input, Select, Textarea } from "@/components/ui";
import { formatBytes } from "@/components/tickets/conversation";
import { ASSET_TYPES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, PRIORITIES, PRIORITY_META, type Priority } from "@/lib/constants";
import { searchArticles, type ArticleHit } from "@/lib/kb/search";
import { cn } from "@/lib/utils";
import { createRequest } from "../actions";
import { TeamIcon } from "./team-icon";

export type TeamOption = { id: string; key: string; name: string; description: string | null; color: string; icon: string };
export type CategoryOption = { id: string; teamId: string; name: string; description: string | null };
export type AssetOption = { id: string; asset_tag: string; name: string; type: string };

const PRIORITY_RING: Record<Priority, string> = {
  urgent: "peer-checked:border-red-400 peer-checked:bg-red-50 peer-checked:ring-red-200",
  high: "peer-checked:border-orange-400 peer-checked:bg-orange-50 peer-checked:ring-orange-200",
  medium: "peer-checked:border-primary-500 peer-checked:bg-primary-50 peer-checked:ring-primary-100",
  low: "peer-checked:border-slate-400 peer-checked:bg-slate-50 peer-checked:ring-slate-200",
};
const PRIORITY_DOT: Record<Priority, string> = { urgent: "bg-red-500", high: "bg-orange-500", medium: "bg-blue-500", low: "bg-slate-400" };
const PRIORITY_ORDER: Priority[] = [...PRIORITIES];

export function NewRequestForm({
  teams,
  categories,
  assets,
  initialTeamId,
  initialAssetId,
}: {
  teams: TeamOption[];
  categories: CategoryOption[];
  assets: AssetOption[];
  initialTeamId: string | null;
  initialAssetId: string | null;
}) {
  const ids = useId();
  const [teamId, setTeamId] = useState<string | null>(initialTeamId);
  const [categoryId, setCategoryId] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [hits, setHits] = useState<ArticleHit[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const team = teams.find((t) => t.id === teamId) ?? null;
  const teamCategories = categories.filter((c) => c.teamId === teamId);
  const selectedCategory = teamCategories.find((c) => c.id === categoryId);

  const chooseTeam = (id: string) => {
    setTeamId(id);
    setCategoryId("");
  };

  const onSubjectChange = (value: string) => {
    setSubject(value);
    if (timer.current) clearTimeout(timer.current);
    const term = value.trim();
    if (term.length < 3) {
      requestId.current++;
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => {
      const id = ++requestId.current;
      searchArticles(term, 4)
        .then((res) => {
          if (id === requestId.current) setHits(res);
        })
        .catch(() => {
          if (id === requestId.current) setHits([]);
        });
    }, 350);
  };

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const fileProblem =
    files.length > MAX_ATTACHMENTS
      ? `You can attach up to ${MAX_ATTACHMENTS} files.`
      : totalBytes > MAX_ATTACHMENT_BYTES
        ? `Files must be 4 MB or less in total (these are ${formatBytes(totalBytes)}).`
        : null;

  const clearFiles = () => {
    if (fileInput.current) fileInput.current.value = "";
    setFiles([]);
  };

  // ---------------------------------------------------------------- Step 1
  if (!team) {
    return (
      <section aria-labelledby={`${ids}-step1`}>
        <StepTitle id={`${ids}-step1`} step={1} title="Who can help?" hint="Pick the team that looks closest. If you're not sure, choose any: they'll pass it on." />
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => chooseTeam(t.id)}
              className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: t.color }} aria-hidden />
              <span className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: t.color }}>
                  <TeamIcon icon={t.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-slate-900">{t.name}</span>
                  {t.description && <span className="mt-1 block text-sm text-slate-500">{t.description}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------- Step 2
  return (
    <ActionForm action={createRequest} resetOnSuccess={false} className="space-y-5">
      <input type="hidden" name="team_id" value={team.id} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: team.color }}>
            <TeamIcon icon={team.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Sending to</p>
            <p className="truncate text-sm font-semibold text-slate-900">{team.name}</p>
          </div>
        </div>
        {teams.length > 1 && (
          <button type="button" onClick={() => setTeamId(null)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">
            <ArrowLeft className="h-3.5 w-3.5" /> Change team
          </button>
        )}
      </div>

      <Card>
        <CardBody className="space-y-5 py-5">
          <StepTitle step={2} title="Tell us what's wrong" className="mb-0" />

          {teamCategories.length > 0 && (
            <Field label="What is it about?" htmlFor={`${ids}-category`} required hint={selectedCategory?.description ?? undefined}>
              <Select id={`${ids}-category`} name="category_id" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="" disabled>
                  Choose a topic…
                </option>
                {teamCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div>
            <Field label="Summary" htmlFor={`${ids}-subject`} required>
              <Input
                id={`${ids}-subject`}
                name="subject"
                required
                minLength={3}
                maxLength={200}
                autoComplete="off"
                placeholder="e.g. Laptop won't connect to the office Wi-Fi"
                value={subject}
                onChange={(e) => onSubjectChange(e.target.value)}
                aria-describedby={`${ids}-subject-hint`}
              />
            </Field>
            <p id={`${ids}-subject-hint`} className="mt-1 flex justify-between gap-2 text-xs text-slate-500">
              <span>One line that describes the problem.</span>
              <span className={cn("tabular-nums", subject.length > 180 && "text-amber-700")}>{subject.length}/200</span>
            </p>
            {hits.length > 0 && <Suggestions hits={hits} />}
          </div>

          <Field
            label="Details"
            htmlFor={`${ids}-description`}
            required
            hint="What happened, when it started, and what you've already tried. Error messages or screenshots help a lot."
          >
            <Textarea
              id={`${ids}-description`}
              name="description"
              required
              maxLength={20000}
              rows={7}
              placeholder="Describe the problem in your own words…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <fieldset>
            <legend className="mb-1.5 block text-xs font-medium text-slate-600">
              How much is this affecting you?<span className="ml-0.5 text-red-500">*</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRIORITY_ORDER.map((p) => (
                <label key={p} className="relative block cursor-pointer">
                  <input type="radio" name="priority" value={p} defaultChecked={p === "medium"} className="peer sr-only" />
                  <span
                    className={cn(
                      "flex h-full items-start gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-3 ring-0 transition hover:border-slate-300 peer-checked:ring-2 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-primary-500",
                      PRIORITY_RING[p],
                    )}
                  >
                    <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", PRIORITY_DOT[p])} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">{PRIORITY_META[p].label}</span>
                      <span className="block text-xs text-slate-500">{PRIORITY_META[p].hint}</span>
                    </span>
                  </span>
                  <Check className="pointer-events-none absolute right-2.5 top-2.5 hidden h-4 w-4 text-primary-600 peer-checked:block" aria-hidden />
                </label>
              ))}
            </div>
          </fieldset>

          {assets.length > 0 && (
            <Field label="Which device?" htmlFor={`${ids}-asset`} hint="Optional. Pick one of your devices if the problem is with it.">
              <Select id={`${ids}-asset`} name="asset_id" defaultValue={initialAssetId ?? ""}>
                <option value="">Not about a specific device</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.asset_tag} · {a.name} ({ASSET_TYPES[a.type as keyof typeof ASSET_TYPES] ?? a.type})
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Attachments</p>
            <label
              htmlFor={`${ids}-files`}
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-5 text-center text-sm text-slate-600 transition hover:border-primary-500 hover:bg-primary-50/40"
            >
              <Paperclip className="h-5 w-5 text-slate-400" aria-hidden />
              <span className="font-medium text-primary-600">Choose files</span>
              <span className="text-xs text-slate-500">Screenshots, photos or documents. Up to {MAX_ATTACHMENTS} files, 4 MB in total.</span>
            </label>
            <input
              ref={fileInput}
              id={`${ids}-files`}
              type="file"
              name="files"
              multiple
              className="sr-only"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <ul className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-slate-400">{formatBytes(f.size)}</span>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={clearFiles} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
                  <X className="h-3.5 w-3.5" /> Remove files
                </button>
              </div>
            )}
            {fileProblem && (
              <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
                {fileProblem}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">You&apos;ll get updates here and in People Success notifications.</p>
        <div className="flex gap-2">
          <Link href="/home" className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </Link>
          <SubmitButton size="lg" disabled={Boolean(fileProblem)} className="flex-1 sm:flex-none">
            <Send className="h-4 w-4" /> Submit request
          </SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

function StepTitle({ id, step, title, hint, className }: { id?: string; step: number; title: string; hint?: string; className?: string }) {
  return (
    <div className={cn("mb-4", className)}>
      <h2 id={id} className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">{step}</span>
        {title}
      </h2>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

function Suggestions({ hits }: { hits: ArticleHit[] }) {
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3" aria-live="polite">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden /> These articles might help
      </p>
      <ul className="space-y-1">
        {hits.map((h) => (
          <li key={h.id}>
            <Link href={`/kb/${h.slug}`} target="_blank" rel="noreferrer" className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white">
              <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800 group-hover:text-primary-700">
                  {h.title}
                  <span className="sr-only"> (opens in a new tab)</span>
                </span>
                {h.summary && <span className="line-clamp-1 block text-xs text-slate-500">{h.summary}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-2 text-[11px] text-amber-800/80">Articles open in a new tab, so you won&apos;t lose what you&apos;ve typed. Still stuck? Carry on below.</p>
    </div>
  );
}
