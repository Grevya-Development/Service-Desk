"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import { BODY_MAX, PLACEHOLDERS, TITLE_MAX, fillSample, unknownPlaceholders } from "../_lib/templates";
import { saveTemplate } from "../actions";

type TeamOption = { id: string; name: string };

/** Create / edit a reply template: name, team, markdown body with placeholder buttons and a live preview. */
export function TemplateEditor({
  template,
  teams,
  defaultTeamId,
  agentName,
}: {
  template?: { id: string; title: string; body: string; team_id: string };
  teams: TeamOption[];
  defaultTeamId?: string;
  agentName: string;
}) {
  const uid = useId();
  const [body, setBody] = useState(template?.body ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const unknown = unknownPlaceholders(body);
  const teamId = template?.team_id ?? (teams.some((t) => t.id === defaultTeamId) ? defaultTeamId : teams[0]?.id);

  const insert = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    if (next.length > BODY_MAX) return;
    pendingCaret.current = start + token.length;
    setBody(next);
  };

  // Put the caret right after an inserted placeholder, in the same frame the new text renders.
  useLayoutEffect(() => {
    const el = ref.current;
    const caret = pendingCaret.current;
    if (!el || caret === null) return;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [body]);

  return (
    <ActionForm action={saveTemplate} className="space-y-4" resetOnSuccess={!template} onSuccess={() => !template && setBody("")}>
      {template && <input type="hidden" name="id" value={template.id} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor={`${uid}-title`} required hint="Only agents see this." className="sm:col-span-2">
          <Input
            id={`${uid}-title`}
            name="title"
            required
            minLength={2}
            maxLength={TITLE_MAX}
            defaultValue={template?.title}
            placeholder="e.g. Password reset steps"
            autoComplete="off"
          />
        </Field>
        {teams.length > 1 ? (
          <Field label="Team" htmlFor={`${uid}-team`} required>
            <Select id={`${uid}-team`} name="team_id" defaultValue={teamId} required>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="team_id" value={teamId} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-end justify-between gap-2">
            <label htmlFor={`${uid}-body`} className="block text-xs font-medium text-slate-600">
              Reply text<span className="ml-0.5 text-red-500">*</span>
            </label>
            <span className={cn("text-[11px] tabular-nums", body.length > BODY_MAX * 0.9 ? "text-amber-700" : "text-slate-400")}>
              {body.length.toLocaleString("en-IN")} / {BODY_MAX.toLocaleString("en-IN")}
            </span>
          </div>
          <textarea
            ref={ref}
            id={`${uid}-body`}
            name="body"
            required
            maxLength={BODY_MAX}
            rows={12}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Hi {{first_name}},\n\n…\n\nThanks,\n{{agent_name}}"}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            aria-describedby={`${uid}-ph`}
          />
          <div id={`${uid}-ph`} className="mt-2">
            <p className="mb-1.5 text-xs text-slate-500">Insert a placeholder. It&apos;s filled in when you use the template in a reply:</p>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  onClick={() => insert(p.token)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-primary-300 hover:bg-primary-50"
                  title={`Insert ${p.token}`}
                >
                  <code className="font-mono text-[11px] text-primary-700">{p.token}</code>
                  <span className="text-slate-500">{p.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">Formatting: **bold**, *italic*, - bullet list, 1. numbered list, [link](https://…)</p>
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <Eye className="h-3.5 w-3.5" aria-hidden />
            Preview
            <span className="font-normal text-slate-400">with example values</span>
          </p>
          <div className="min-h-[12rem] rounded-lg border border-slate-200 bg-slate-50/60 p-3" aria-live="polite">
            {body.trim() ? <Markdown source={fillSample(body, agentName)} /> : <p className="text-sm text-slate-400">Start typing to see how your reply will look.</p>}
          </div>
          {unknown.length > 0 && (
            <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800" role="alert">
              {unknown.join(", ")} won&apos;t be filled in. Use one of the placeholder buttons instead.
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <SubmitButton disabled={unknown.length > 0}>{template ? "Save template" : "Add template"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
