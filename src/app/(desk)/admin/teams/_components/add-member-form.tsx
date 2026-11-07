"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Avatar } from "@/components/ui/avatar";
import { Field, Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { addMember } from "../actions";

export type PickPerson = { id: string; full_name: string | null; email: string; department: string | null; designation: string | null; avatar_url: string | null };

/** Searchable employee picker + role select. */
export function AddMemberForm({ teamId, people }: { teamId: string; people: PickPerson[] }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? people.filter((p) => [p.full_name, p.email, p.department, p.designation].some((v) => v?.toLowerCase().includes(t)))
      : people;
    return list.slice(0, 50);
  }, [people, q]);
  const chosen = people.find((p) => p.id === selected);

  if (!people.length) {
    return <p className="text-sm text-slate-500">Everyone who is an active employee is already on this team.</p>;
  }

  return (
    <ActionForm action={addMember} className="space-y-4" onSuccess={() => setSelected(null)}>
      <input type="hidden" name="team_id" value={teamId} />
      <input type="hidden" name="employee_id" value={selected ?? ""} />

      <div>
        <label htmlFor="member-search" className="mb-1.5 block text-xs font-medium text-slate-600">
          Person<span className="ml-0.5 text-red-500">*</span>
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input id="member-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email or department" className="pl-9" autoComplete="off" />
        </div>
        <ul role="listbox" aria-label="Employees" className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 thin-scroll">
          {matches.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-500">No one matches “{q}”.</li>}
          {matches.map((p) => {
            const active = p.id === selected;
            return (
              <li key={p.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left transition-colors", active ? "bg-primary-50" : "hover:bg-slate-50")}
                >
                  <Avatar name={p.full_name} src={p.avatar_url} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{p.full_name ?? p.email}</span>
                    <span className="block truncate text-xs text-slate-500">{[p.designation, p.department].filter(Boolean).join(" · ") || p.email}</span>
                  </span>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary-600" />}
                </button>
              </li>
            );
          })}
        </ul>
        {matches.length === 50 && <p className="mt-1 text-xs text-slate-500">Showing the first 50. Type to narrow the list.</p>}
      </div>

      <Field label="Role" htmlFor="member-role" hint="Leads can also manage members, categories, SLA targets and the service catalog.">
        <Select id="member-role" name="role" defaultValue="agent">
          <option value="agent">Agent: works the team&apos;s tickets</option>
          <option value="lead">Team lead: agent + manages the team</option>
        </Select>
      </Field>

      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-xs text-slate-500">{chosen ? `Adding ${chosen.full_name ?? chosen.email}` : "Pick someone from the list."}</p>
        <SubmitButton disabled={!selected}>Add to team</SubmitButton>
      </div>
    </ActionForm>
  );
}
