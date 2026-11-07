"use client";

import { useMemo, useState } from "react";
import { Paperclip, Send, Upload } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { MAX_ATTACHMENTS, PRIORITIES, PRIORITY_META } from "@/lib/constants";
import { FileChips, useFileAttachments } from "@/components/tickets/attachments";
import { formatBytes } from "@/components/tickets/format";
import { cn } from "@/lib/utils";
import { createTicket } from "../actions";

type Employee = { id: string; full_name: string | null; email: string; department: string | null; designation: string | null };
type Team = { id: string; name: string };
type Category = { id: string; name: string; team_id: string };
type Agent = { id: string; name: string; team_id: string };

export function NewTicketForm({
  employees,
  teams,
  categories,
  agents,
  meId,
  memberTeamIds,
}: {
  employees: Employee[];
  teams: Team[];
  categories: Category[];
  agents: Agent[];
  meId: string;
  memberTeamIds: string[];
}) {
  const [filter, setFilter] = useState("");
  const [requesterId, setRequesterId] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [assignToMe, setAssignToMe] = useState(memberTeamIds.includes(teams[0]?.id ?? ""));
  const attach = useFileAttachments();

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.id === requesterId || [e.full_name, e.email, e.department].some((v) => v?.toLowerCase().includes(q)));
  }, [employees, filter, requesterId]);
  const requester = employees.find((e) => e.id === requesterId);
  const canSelfAssign = memberTeamIds.includes(teamId);
  const teamCategories = categories.filter((c) => c.team_id === teamId);
  const teamAgents = agents.filter((a) => a.team_id === teamId);

  return (
    <ActionForm action={createTicket} resetOnSuccess={false} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-xs font-medium text-slate-600">
          Who is this for?<span className="ml-0.5 text-red-500">*</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
          <div>
            <label htmlFor="nt-filter" className="sr-only">
              Filter employees
            </label>
            <Input id="nt-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Type a name, email or team…" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="nt-requester" className="sr-only">
              Employee
            </label>
            <Select id="nt-requester" name="requester_id" required value={requesterId} onChange={(e) => setRequesterId(e.target.value)}>
              <option value="">{shown.length ? `Choose an employee (${shown.length})` : "No employees match"}</option>
              {shown.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name ?? e.email}
                  {e.department ? ` — ${e.department}` : ""}
                  {e.id === meId ? " (me)" : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {requester && (
          <p className="text-xs text-slate-500">
            {requester.email}
            {requester.designation && <> · {requester.designation}</>}
            {requester.department && <> · {requester.department}</>}
          </p>
        )}
      </fieldset>

      <FormGrid>
        <Field label="Team" htmlFor="nt-team" required>
          <Select
            id="nt-team"
            name="team_id"
            required
            value={teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              setAssignToMe(memberTeamIds.includes(e.target.value));
            }}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category" htmlFor="nt-category">
          <Select id="nt-category" name="category_id" key={teamId} defaultValue="">
            <option value="">No category</option>
            {teamCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="nt-priority" required>
          <Select id="nt-priority" name="priority" defaultValue="medium">
            {[...PRIORITIES].reverse().map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label} — {PRIORITY_META[p].hint}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="nt-status" hint="Choose Open if you're already working on it.">
          <Select id="nt-status" name="status" defaultValue="new">
            <option value="new">New</option>
            <option value="open">Open</option>
          </Select>
        </Field>
      </FormGrid>

      <Field label="Subject" htmlFor="nt-subject" required>
        <Input id="nt-subject" name="subject" required minLength={3} maxLength={200} placeholder="e.g. Laptop won't connect to office Wi-Fi" />
      </Field>
      <Field label="Description" htmlFor="nt-description" required hint="Markdown supported: **bold**, lists and links.">
        <Textarea id="nt-description" name="description" required rows={6} onPaste={attach.onPaste} maxLength={20000} placeholder="What happened, when it started, and anything already tried." />
      </Field>

      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <p className="mb-2 text-xs font-medium text-slate-600">Assignment</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {canSelfAssign && <Checkbox name="assign_to_me" label="Assign to me" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} />}
          {!assignToMe || !canSelfAssign ? (
            <div className="min-w-[14rem] flex-1">
              <label htmlFor="nt-assignee" className="sr-only">
                Assignee
              </label>
              <Select id="nt-assignee" name="assignee_id" key={teamId} defaultValue="">
                <option value="">Unassigned (or auto-assign, if the team uses it)</option>
                {teamAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.id === meId ? " (me)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      </div>

      <div {...attach.dropProps} className={cn("rounded-lg border border-dashed border-slate-300 p-3 transition-colors", attach.dragging && "border-primary-500 bg-primary-50/60")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-700 focus-within:ring-2 focus-within:ring-primary-500 hover:bg-slate-100">
            <Paperclip className="h-3.5 w-3.5" />
            {attach.files.length ? "Add more files" : "Attach files"}
            <input {...attach.inputProps} />
          </label>
          <span className="text-[11px] text-slate-500">
            {attach.dragging ? (
              <span className="inline-flex items-center gap-1 font-medium text-primary-700">
                <Upload className="h-3.5 w-3.5" /> Drop to attach
              </span>
            ) : attach.files.length ? (
              `${attach.files.length} of ${MAX_ATTACHMENTS} files · ${formatBytes(attach.totalBytes)} of 4 MB`
            ) : (
              `Drop files here or paste a screenshot into the description. Up to ${MAX_ATTACHMENTS} files, 4 MB in total.`
            )}
          </span>
        </div>
        <FileChips files={attach.files} onRemove={attach.removeFile} className="mt-2 flex flex-wrap gap-1.5" />
      </div>

      <div className="flex justify-end border-t border-slate-100 pt-4">
        <SubmitButton>
          <Send className="h-4 w-4" /> Create ticket
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
