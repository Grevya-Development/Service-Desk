"use client";

import { useId, useMemo, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Clock, Eye, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, FormGrid, Input, Label, Select, Textarea } from "@/components/ui/form";
import { APPROVAL_KINDS, FIELD_TYPES, PRIORITIES, PRIORITY_META, type ApprovalKind, type CatalogField, type FieldType, type Priority } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { CATALOG_ICONS, NamedIcon } from "../../_lib/icons";
import { FIELD_KEY_RE, FIELD_LIMITS, keyFromLabel, uniqueKey, validateFields } from "../../_lib/validate";
import { saveCatalogItem } from "../actions";

export type EditorTeam = { id: string; name: string; color: string };
export type EditorCategory = { id: string; team_id: string; name: string; active: boolean };
export type EditorItem = {
  id: string;
  team_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  icon: string;
  approval: ApprovalKind;
  default_priority: Priority;
  expected_days: number | null;
  active: boolean;
  sort_order: number;
  fields: CatalogField[];
};

type DraftField = { uid: string; label: string; key: string; keyTouched: boolean; type: FieldType; required: boolean; help: string; optionsText: string };

const APPROVAL_HELP: Record<ApprovalKind, string> = {
  none: "Work starts as soon as the request comes in.",
  manager: "The requester's manager approves first. If they have no manager, a team lead approves instead.",
  team_lead: "One of this team's leads approves first.",
};

/** Only called from event handlers (never during render), so ids stay stable for hydration. */
const randomUid = () => `n${Math.random().toString(36).slice(2, 10)}`;

function toDraft(f: CatalogField, i: number): DraftField {
  return {
    uid: `i${i}`,
    label: f.label,
    key: f.key,
    keyTouched: true, // existing keys stay put so past requests still line up
    type: f.type,
    required: Boolean(f.required),
    help: f.help ?? "",
    optionsText: (f.options ?? []).join("\n"),
  };
}

function toField(d: DraftField): CatalogField {
  const f: CatalogField = { key: d.key.trim(), label: d.label.trim(), type: d.type };
  if (d.required) f.required = true;
  if (d.help.trim()) f.help = d.help.trim();
  if (d.type === "select") f.options = d.optionsText.split("\n").map((o) => o.trim()).filter(Boolean);
  return f;
}

export function CatalogEditor({ item, teams, categories, defaultTeamId }: { item?: EditorItem; teams: EditorTeam[]; categories: EditorCategory[]; defaultTeamId?: string }) {
  const idp = useId();
  const [teamId, setTeamId] = useState(item?.team_id ?? defaultTeamId ?? teams[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(item?.category_id ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [icon, setIcon] = useState(item?.icon && CATALOG_ICONS[item.icon] ? item.icon : "package");
  const [approval, setApproval] = useState<ApprovalKind>(item?.approval ?? "none");
  const [expectedDays, setExpectedDays] = useState(item?.expected_days != null ? String(item.expected_days) : "");
  const [fields, setFields] = useState<DraftField[]>(() => (item?.fields ?? []).map((f, i) => toDraft(f, i)));

  const team = teams.find((t) => t.id === teamId);
  const teamCategories = categories.filter((c) => c.team_id === teamId && (c.active || c.id === categoryId));

  const cleaned = useMemo(() => fields.map(toField), [fields]);
  const check = useMemo(() => validateFields(cleaned), [cleaned]);
  const keyCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of fields) m.set(f.key, (m.get(f.key) ?? 0) + 1);
    return m;
  }, [fields]);

  const update = (uid: string, patch: Partial<DraftField>) =>
    setFields((list) =>
      list.map((f) => {
        if (f.uid !== uid) return f;
        const next = { ...f, ...patch };
        if (patch.label !== undefined && !f.keyTouched) {
          const taken = new Set(list.filter((o) => o.uid !== uid).map((o) => o.key));
          next.key = uniqueKey(keyFromLabel(patch.label), taken);
        }
        return next;
      }),
    );

  const addField = () =>
    setFields((list) => {
      const taken = new Set(list.map((f) => f.key));
      return [...list, { uid: randomUid(), label: "", key: uniqueKey("field", taken), keyTouched: false, type: "text", required: false, help: "", optionsText: "" }];
    });

  const move = (i: number, dir: -1 | 1) =>
    setFields((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = list.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const nameOk = name.trim().length >= 2;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <ActionForm action={saveCatalogItem} resetOnSuccess={false} className="min-w-0 space-y-5">
        {item && <input type="hidden" name="id" value={item.id} />}
        <input type="hidden" name="fields" value={JSON.stringify(cleaned)} />
        <input type="hidden" name="icon" value={icon} />

        <Card>
          <CardHeader title="Basics" description="What employees see in the service catalog." />
          <CardBody className="space-y-4">
            <FormGrid>
              <Field label="Team" htmlFor={`${idp}-team`} required hint="The team that does the work.">
                <Select
                  id={`${idp}-team`}
                  name="team_id"
                  value={teamId}
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    setCategoryId("");
                  }}
                  required
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Category" htmlFor={`${idp}-cat`} hint="Optional. Groups the item in the catalog and in reports.">
                <Select id={`${idp}-cat`} name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">No category</option>
                  {teamCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>
            <Field label="Name" htmlFor={`${idp}-name`} required hint="Start with what they want, e.g. “New laptop” or “Experience letter”.">
              <Input id={`${idp}-name`} name="name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required />
            </Field>
            <Field label="Description" htmlFor={`${idp}-desc`} hint="A sentence or two: what they get and anything they should know first.">
              <Textarea id={`${idp}-desc`} name="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} />
            </Field>
            <fieldset>
              <legend className="mb-1.5 block text-xs font-medium text-slate-600">Icon</legend>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-9" role="radiogroup" aria-label="Icon">
                {Object.keys(CATALOG_ICONS).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={icon === n}
                    aria-label={n.replace(/-/g, " ")}
                    title={n.replace(/-/g, " ")}
                    onClick={() => setIcon(n)}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-lg border transition",
                      icon === n ? "border-primary-500 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-500 hover:bg-slate-50",
                    )}
                  >
                    <NamedIcon name={n} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </fieldset>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="How it's handled" />
          <CardBody className="space-y-4">
            <fieldset>
              <legend className="mb-1.5 block text-xs font-medium text-slate-600">Approval</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.keys(APPROVAL_KINDS) as ApprovalKind[]).map((k) => (
                  <label
                    key={k}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition",
                      approval === k ? "border-primary-500 bg-primary-50/60 ring-1 ring-primary-500" : "border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <input type="radio" name="approval" value={k} checked={approval === k} onChange={() => setApproval(k)} className="h-4 w-4 text-primary-600" />
                      {APPROVAL_KINDS[k]}
                    </span>
                    <span className="text-xs text-slate-500">{APPROVAL_HELP[k]}</span>
                  </label>
                ))}
              </div>
              {approval !== "none" && <p className="mt-2 text-xs text-slate-500">The SLA clock starts once the request is approved. Rejected requests are closed.</p>}
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Default priority" htmlFor={`${idp}-prio`} hint="Agents can change it later.">
                <Select id={`${idp}-prio`} name="default_priority" defaultValue={item?.default_priority ?? "medium"}>
                  {PRIORITIES.slice()
                    .reverse()
                    .map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_META[p].label}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Usually takes (days)" htmlFor={`${idp}-days`} hint="Shown to requesters. Leave blank if it varies.">
                <Input id={`${idp}-days`} name="expected_days" type="number" min={0} max={365} step={1} value={expectedDays} onChange={(e) => setExpectedDays(e.target.value)} />
              </Field>
              <Field label="Sort order" htmlFor={`${idp}-sort`} hint="Lower numbers show first.">
                <Input id={`${idp}-sort`} name="sort_order" type="number" min={-9999} max={9999} step={1} defaultValue={item?.sort_order ?? 0} />
              </Field>
            </div>
            <div>
              <Checkbox name="active" defaultChecked={item?.active ?? true} label="Show in the catalog" />
              <p className="ml-6 mt-0.5 text-xs text-slate-500">Turn off to hide it from employees without losing past requests.</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Form fields"
            description={`Questions the requester answers when they ask for this (up to ${FIELD_LIMITS.fields}).`}
            action={
              <Button variant="secondary" size="sm" onClick={addField} disabled={fields.length >= FIELD_LIMITS.fields}>
                <Plus className="h-3.5 w-3.5" />
                Add field
              </Button>
            }
          />
          <CardBody className="space-y-3">
            {fields.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center">
                <p className="text-sm font-medium text-slate-700">No extra questions</p>
                <p className="mt-1 text-xs text-slate-500">Add fields for details you always need, like a laptop model or a start date.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={addField}>
                  <Plus className="h-3.5 w-3.5" />
                  Add the first field
                </Button>
              </div>
            )}
            {fields.map((f, i) => {
              const fid = `${idp}-${f.uid}`;
              const keyBad = !FIELD_KEY_RE.test(f.key) || (keyCounts.get(f.key) ?? 0) > 1;
              const optionCount = f.optionsText.split("\n").filter((o) => o.trim()).length;
              return (
                <div key={f.uid} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Field {i + 1}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move field ${i + 1} up`}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => move(i, 1)}
                        disabled={i === fields.length - 1}
                        aria-label={`Move field ${i + 1} down`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-600 hover:bg-red-50"
                        onClick={() => setFields((list) => list.filter((x) => x.uid !== f.uid))}
                        aria-label={`Remove field ${i + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Question" htmlFor={`${fid}-label`} required>
                      <Input
                        id={`${fid}-label`}
                        value={f.label}
                        onChange={(e) => update(f.uid, { label: e.target.value })}
                        maxLength={FIELD_LIMITS.label}
                        placeholder="e.g. Which laptop model?"
                      />
                    </Field>
                    <Field label="Answer type" htmlFor={`${fid}-type`}>
                      <Select id={`${fid}-type`} value={f.type} onChange={(e) => update(f.uid, { type: e.target.value as FieldType })}>
                        {(Object.keys(FIELD_TYPES) as FieldType[]).map((t) => (
                          <option key={t} value={t}>
                            {FIELD_TYPES[t]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Help text" htmlFor={`${fid}-help`} hint="Optional hint under the question.">
                      <Input id={`${fid}-help`} value={f.help} onChange={(e) => update(f.uid, { help: e.target.value })} maxLength={FIELD_LIMITS.help} />
                    </Field>
                    <Field
                      label="Key"
                      htmlFor={`${fid}-key`}
                      hint={keyBad ? undefined : item && f.keyTouched ? "Stored with each request. Avoid changing it once requests exist." : "Filled in from the question."}
                    >
                      <Input
                        id={`${fid}-key`}
                        value={f.key}
                        onChange={(e) => update(f.uid, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"), keyTouched: true })}
                        maxLength={41}
                        className={cn("font-mono text-xs", keyBad && "border-red-400")}
                        aria-invalid={keyBad}
                      />
                      {keyBad && (
                        <p className="mt-1 text-xs text-red-600">
                          {(keyCounts.get(f.key) ?? 0) > 1 ? "Another field uses this key." : "Start with a letter; use lowercase letters, numbers and _."}
                        </p>
                      )}
                    </Field>
                    {f.type === "select" && (
                      <Field
                        label="Options"
                        htmlFor={`${fid}-options`}
                        required
                        className="sm:col-span-2"
                        hint={`One per line. ${optionCount}/${FIELD_LIMITS.options} options.`}
                      >
                        <Textarea
                          id={`${fid}-options`}
                          value={f.optionsText}
                          onChange={(e) => update(f.uid, { optionsText: e.target.value })}
                          rows={4}
                          placeholder={"MacBook Air\nDell Latitude\nLenovo ThinkPad"}
                        />
                      </Field>
                    )}
                  </div>
                  <Checkbox className="mt-3" checked={f.required} onChange={(e) => update(f.uid, { required: e.target.checked })} label="Required" />
                </div>
              );
            })}
            {fields.length > 0 && fields.length < FIELD_LIMITS.fields && (
              <Button variant="outline" size="sm" onClick={addField}>
                <Plus className="h-3.5 w-3.5" />
                Add another field
              </Button>
            )}
          </CardBody>
        </Card>

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          {check.ok ? (
            <p className="text-xs text-slate-500">{item ? "Changes apply to new requests. Past requests keep their answers." : "You can change everything later."}</p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {check.error}
            </p>
          )}
          <SubmitButton disabled={!check.ok || !nameOk || !teamId}>{item ? "Save changes" : "Create item"}</SubmitButton>
        </div>
      </ActionForm>

      {/* Live preview (outside the form so nothing here is submitted) */}
      <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
          <Eye className="h-3.5 w-3.5" />
          Preview: what requesters see
        </p>
        <Card className="overflow-hidden">
          <div className="h-1" style={{ backgroundColor: team?.color ?? "#2d48c8" }} />
          <div className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <NamedIcon name={icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-900">{name.trim() || "Item name"}</p>
                <p className="text-xs text-slate-500">{team?.name ?? "Team"}</p>
              </div>
            </div>
            {description.trim() && <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{description}</p>}
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              {expectedDays !== "" && Number(expectedDays) >= 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                  <Clock className="h-3 w-3" />
                  {Number(expectedDays) === 0 ? "Same day" : `Usually ${expectedDays} day${Number(expectedDays) === 1 ? "" : "s"}`}
                </span>
              )}
              {approval !== "none" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                  <ShieldCheck className="h-3 w-3" />
                  Needs {approval === "manager" ? "your manager's" : "team lead"} approval
                </span>
              )}
            </div>

            <div className="mt-5 space-y-4 border-t border-slate-100 pt-4">
              {cleaned.map((f, i) => (
                <PreviewField key={fields[i].uid} field={f} id={`${idp}-pv-${fields[i].uid}`} />
              ))}
              <div>
                <Label>Anything else we should know?</Label>
                <Textarea rows={2} disabled placeholder="Requesters add details here." />
              </div>
              <Button className="w-full" disabled>
                Submit request
              </Button>
            </div>
          </div>
        </Card>
      </aside>
    </div>
  );
}

function PreviewField({ field, id }: { field: CatalogField; id: string }) {
  const label = field.label || "Untitled question";
  if (field.type === "checkbox") {
    return (
      <div>
        <Checkbox id={id} label={label + (field.required ? " *" : "")} />
        {field.help && <p className="ml-6 mt-0.5 text-xs text-slate-500">{field.help}</p>}
      </div>
    );
  }
  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
      control = <Textarea id={id} rows={3} />;
      break;
    case "number":
      control = <Input id={id} type="number" />;
      break;
    case "date":
      control = <Input id={id} type="date" />;
      break;
    case "select":
      control = (
        <Select id={id} defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {(field.options ?? []).map((o, i) => (
            <option key={`${i}-${o}`}>{o}</option>
          ))}
        </Select>
      );
      break;
    default:
      control = <Input id={id} />;
  }
  return (
    <Field label={label} htmlFor={id} required={field.required} hint={field.help}>
      {control}
    </Field>
  );
}
