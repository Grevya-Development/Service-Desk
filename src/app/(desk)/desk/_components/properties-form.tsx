"use client";

import { useState } from "react";
import { AlertTriangle, Save } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Select } from "@/components/ui/form";
import { PRIORITIES, PRIORITY_META, STATUSES, STATUS_META } from "@/lib/constants";
import { updateTicket } from "../actions";

type Option = { id: string; name: string };
type TeamOption = Option & { active: boolean };
type CategoryOption = Option & { team_id: string };
type AgentOption = Option & { team_id: string };

export type PropertiesTicket = {
  id: string;
  status: string;
  priority: string;
  team_id: string;
  category_id: string | null;
  assignee_id: string | null;
  asset_id: string | null;
  approval_status: string;
};

/**
 * Sidebar form for the ticket's working fields. Changing the team (transfer)
 * narrows category / assignee to the new team; the server only sends changes.
 */
export function PropertiesForm({
  ticket,
  teams,
  categories,
  agents,
  assets,
  meId,
}: {
  ticket: PropertiesTicket;
  teams: TeamOption[];
  categories: CategoryOption[];
  agents: AgentOption[];
  /** null hides the asset field (viewer can't manage assets) */
  assets: Option[] | null;
  meId: string;
}) {
  const [teamId, setTeamId] = useState(ticket.team_id);
  const [categoryId, setCategoryId] = useState(ticket.category_id ?? "");
  const [assigneeId, setAssigneeId] = useState(ticket.assignee_id ?? "");
  const awaitingApproval = ticket.approval_status === "pending";
  const transferring = teamId !== ticket.team_id;

  const teamCategories = categories.filter((c) => c.team_id === teamId);
  const teamAgents = agents.filter((a) => a.team_id === teamId);

  const changeTeam = (next: string) => {
    setTeamId(next);
    if (next === ticket.team_id) {
      setCategoryId(ticket.category_id ?? "");
      setAssigneeId(ticket.assignee_id ?? "");
      return;
    }
    setCategoryId("");
    // The database keeps the assignee only when they're also on the new team.
    setAssigneeId(ticket.assignee_id && agents.some((a) => a.team_id === next && a.id === ticket.assignee_id) ? ticket.assignee_id : "");
  };

  return (
    <ActionForm action={updateTicket} resetOnSuccess={false} className="space-y-3.5">
      <input type="hidden" name="ticket_id" value={ticket.id} />

      <Field label="Status" htmlFor="prop-status" hint={awaitingApproval ? "Locked until the approval is decided." : undefined}>
        <Select id="prop-status" name="status" defaultValue={ticket.status} disabled={awaitingApproval}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
              {s === "pending" ? " (waiting on requester)" : ""}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Priority" htmlFor="prop-priority">
        <Select id="prop-priority" name="priority" defaultValue={ticket.priority}>
          {[...PRIORITIES].reverse().map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Team" htmlFor="prop-team">
        <Select id="prop-team" name="team_id" value={teamId} onChange={(e) => changeTeam(e.target.value)}>
          {teams
            .filter((t) => t.active || t.id === ticket.team_id)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </Select>
      </Field>
      {transferring && (
        <p className="flex gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Transferring resets the category and the assignee (unless they&apos;re on the new team), and restarts the SLA with the new team&apos;s targets.
        </p>
      )}

      <Field label="Category" htmlFor="prop-category">
        <Select id="prop-category" name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">No category</option>
          {teamCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Assignee" htmlFor="prop-assignee">
        <Select id="prop-assignee" name="assignee_id" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Unassigned</option>
          {teamAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.id === meId ? " (me)" : ""}
            </option>
          ))}
        </Select>
      </Field>

      {assets && (
        <Field label="Linked asset" htmlFor="prop-asset" hint={assets.length ? undefined : "The requester has no assets assigned."}>
          <Select id="prop-asset" name="asset_id" defaultValue={ticket.asset_id ?? ""}>
            <option value="">None</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <SubmitButton className="w-full">
        <Save className="h-4 w-4" /> {transferring ? "Transfer ticket" : "Save changes"}
      </SubmitButton>
    </ActionForm>
  );
}
