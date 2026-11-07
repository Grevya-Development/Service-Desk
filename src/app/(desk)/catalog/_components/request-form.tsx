"use client";

import { useRef, useState, type ReactNode } from "react";
import { Paperclip, Send, X } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Label, Select, Textarea } from "@/components/ui/form";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, PRIORITIES, PRIORITY_META, type CatalogField, type Priority } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { submitCatalogRequest } from "../actions";
import { MAX_NOTE, MAX_TEXT, MAX_TEXTAREA, fieldInputName } from "../_lib/fields";

const inputId = (key: string) => `field-${key}`;

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Request form generated from the catalog item's custom fields. */
export function RequestForm({ itemId, fields, defaultPriority }: { itemId: string; fields: CatalogField[]; defaultPriority: Priority }) {
  const [priority, setPriority] = useState<Priority>(defaultPriority);

  return (
    <ActionForm action={submitCatalogRequest} resetOnSuccess={false} className="space-y-6">
      <input type="hidden" name="item_id" value={itemId} />

      {fields.length > 0 && (
        <div className="space-y-5">
          {fields.map((f) => (
            <CatalogFieldInput key={f.key} field={f} />
          ))}
        </div>
      )}

      <div className={cn("space-y-5", fields.length > 0 && "border-t border-slate-100 pt-6")}>
        <Field label="Anything else we should know?" htmlFor="description" hint="Optional. Add any details that will help us get this right.">
          <Textarea id="description" name="description" rows={4} maxLength={MAX_NOTE} placeholder="e.g. I need this before my client visit on Monday" />
        </Field>

        <Field label="How urgent is this?" htmlFor="priority" hint={PRIORITY_META[priority].hint}>
          <Select id="priority" name="priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="sm:max-w-xs">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </Select>
        </Field>

        <FilePicker />
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          Fields marked <span className="text-red-500">*</span> are required.
        </p>
        <SubmitButton size="lg" className="w-full sm:w-auto">
          <Send className="h-4 w-4" /> Submit request
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

function CatalogFieldInput({ field: f }: { field: CatalogField }) {
  const id = inputId(f.key);
  const name = fieldInputName(f.key);
  const helpId = f.help ? `${id}-help` : undefined;

  if (f.type === "checkbox") {
    return (
      <div>
        <Checkbox
          id={id}
          name={name}
          required={f.required}
          aria-describedby={helpId}
          label={
            <span>
              {f.label}
              {f.required && <span className="ml-0.5 text-red-500">*</span>}
            </span>
          }
        />
        {f.help && (
          <p id={helpId} className="mt-1 pl-6 text-xs text-slate-500">
            {f.help}
          </p>
        )}
      </div>
    );
  }

  const common = { id, name, required: f.required, "aria-describedby": helpId };
  let control: ReactNode;
  switch (f.type) {
    case "textarea":
      control = <Textarea {...common} rows={4} maxLength={MAX_TEXTAREA} />;
      break;
    case "number":
      control = <Input {...common} type="number" step="any" inputMode="decimal" className="sm:max-w-xs" />;
      break;
    case "date":
      control = <Input {...common} type="date" className="sm:max-w-xs" />;
      break;
    case "select":
      control = f.options?.length ? (
        <Select {...common} defaultValue="" className="sm:max-w-md">
          <option value="" disabled={f.required}>
            {f.required ? "Choose one…" : "Choose one (optional)"}
          </option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : (
        <Input {...common} maxLength={MAX_TEXT} />
      );
      break;
    default:
      control = <Input {...common} maxLength={MAX_TEXT} />;
  }

  return (
    <div>
      <Label htmlFor={id} required={f.required}>
        {f.label}
      </Label>
      {control}
      {f.help && (
        <p id={helpId} className="mt-1 text-xs text-slate-500">
          {f.help}
        </p>
      )}
    </div>
  );
}

function FilePicker() {
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const total = files.reduce((n, f) => n + f.size, 0);
  const tooMany = files.length > MAX_ATTACHMENTS;
  const tooBig = total > MAX_ATTACHMENT_BYTES;

  return (
    <div>
      <Label htmlFor="files">Attachments</Label>
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="files"
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 text-sm text-slate-600 hover:border-primary-500 hover:text-primary-700 focus-within:ring-2 focus-within:ring-primary-500/30"
        >
          <Paperclip className="h-4 w-4" aria-hidden />
          {files.length ? "Choose different files" : "Add files"}
          <input
            ref={ref}
            id="files"
            type="file"
            name="files"
            multiple
            className="sr-only"
            aria-describedby="files-help"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        {files.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (ref.current) ref.current.value = "";
              setFiles([]);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Remove all
          </button>
        )}
      </div>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-slate-600">
              <Paperclip className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-slate-400">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}
      <p id="files-help" className={cn("mt-1 text-xs", tooMany || tooBig ? "text-red-600" : "text-slate-500")} role={tooMany || tooBig ? "alert" : undefined}>
        {tooMany
          ? `You can attach up to ${MAX_ATTACHMENTS} files. Please remove some.`
          : tooBig
            ? `These files add up to ${formatBytes(total)}. The limit is 4 MB in total.`
            : "Optional. Screenshots, quotes or documents — up to 5 files, 4 MB in total."}
      </p>
    </div>
  );
}
