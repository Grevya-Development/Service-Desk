"use client";

import { useState, type ReactNode } from "react";
import { Send } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Label, Select, Textarea } from "@/components/ui/form";
import { PRIORITIES, PRIORITY_META, type CatalogField, type Priority } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { FileDropZone, filesProblem } from "../../_components/file-drop-zone";
import { submitCatalogRequest } from "../actions";
import { MAX_NOTE, MAX_TEXT, MAX_TEXTAREA, fieldInputName } from "../_lib/fields";

const inputId = (key: string) => `field-${key}`;

/** Request form generated from the catalog item's custom fields. */
export function RequestForm({ itemId, fields, defaultPriority }: { itemId: string; fields: CatalogField[]; defaultPriority: Priority }) {
  const [priority, setPriority] = useState<Priority>(defaultPriority);
  const [files, setFiles] = useState<File[]>([]);
  const fileProblem = filesProblem(files);

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

        <FileDropZone files={files} onChange={setFiles} label="Attachments (optional)" hint="Screenshots, quotes or documents." />
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          Fields marked <span className="text-red-500">*</span> are required.
        </p>
        <SubmitButton size="lg" disabled={Boolean(fileProblem)} className="w-full sm:w-auto">
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
