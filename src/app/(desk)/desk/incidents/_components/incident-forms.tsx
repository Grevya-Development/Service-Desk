import { CheckCircle2, Link2, Megaphone, Pencil, Plus, Send } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { INCIDENT_STATUS_META, SEVERITIES, SEVERITY_META, UPDATE_STATUSES, peopleCount, type Severity } from "../../../status/_lib/incident";
import { declareIncident, editIncident, linkTickets, postIncidentUpdate, resolveIncident } from "../actions";

type TeamOption = { id: string; name: string };

/** Big radio cards: Major (red) / Minor (amber). Pure CSS, no client state. */
function SeverityPicker({ name, defaultValue, idPrefix }: { name: string; defaultValue: Severity; idPrefix: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-xs font-medium text-slate-600">How serious is it?</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SEVERITIES.map((s) => (
          <label
            key={s}
            htmlFor={`${idPrefix}-${s}`}
            className={cn(
              "flex cursor-pointer gap-2.5 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50",
              s === "major" ? "has-[:checked]:border-red-300 has-[:checked]:bg-red-50" : "has-[:checked]:border-amber-300 has-[:checked]:bg-amber-50",
            )}
          >
            <input
              id={`${idPrefix}-${s}`}
              type="radio"
              name={name}
              value={s}
              defaultChecked={s === defaultValue}
              className={cn("mt-0.5 h-4 w-4", s === "major" ? "accent-red-600" : "accent-amber-500")}
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                <span aria-hidden className={cn("h-2 w-2 rounded-full", SEVERITY_META[s].dot)} />
                {SEVERITY_META[s].label}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">{SEVERITY_META[s].hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DetailsFields({ idPrefix, title, summary, severity }: { idPrefix: string; title?: string; summary?: string; severity: Severity }) {
  return (
    <>
      <Field label="Title" htmlFor={`${idPrefix}-title`} required hint="What's broken, in a few words. Everyone will see this.">
        <Input id={`${idPrefix}-title`} name="title" required minLength={3} maxLength={120} defaultValue={title} placeholder="e.g. Email is not working" autoComplete="off" />
      </Field>
      <Field
        label="What people see"
        htmlFor={`${idPrefix}-summary`}
        required
        hint="Plain words: who's affected, and what they can do meanwhile. No need to explain the technical cause."
      >
        <Textarea
          id={`${idPrefix}-summary`}
          name="summary"
          required
          minLength={3}
          maxLength={2000}
          rows={4}
          defaultValue={summary}
          placeholder="e.g. Some people can't send or receive email. We're looking into it. Use Teams chat for anything urgent."
        />
      </Field>
      <SeverityPicker name="severity" defaultValue={severity} idPrefix={`${idPrefix}-sev`} />
    </>
  );
}

export function DeclareIncidentDialog({ teams, defaultTeamId, size = "md" }: { teams: TeamOption[]; defaultTeamId?: string; size?: "sm" | "md" }) {
  const team = teams.find((t) => t.id === defaultTeamId) ?? teams[0];
  if (!team) return null;
  return (
    <Dialog
      title="Declare an incident"
      description="Use this when something is down for several people. It shows on the Service status page right away."
      trigger={
        <Button variant="danger" size={size}>
          <Megaphone className="h-4 w-4" aria-hidden />
          Declare incident
        </Button>
      }
    >
      <ActionForm action={declareIncident} className="space-y-4">
        {teams.length > 1 ? (
          <Field label="Team" htmlFor="declare-team" required hint="The team fixing it.">
            <Select id="declare-team" name="team_id" defaultValue={team.id} required>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="team_id" value={team.id} />
        )}
        <DetailsFields idPrefix="declare" severity="major" />
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">Your team leads get a notification.</p>
          <SubmitButton variant="danger">
            <Megaphone className="h-4 w-4" aria-hidden />
            Declare incident
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function EditIncidentDialog({ id, title, summary, severity }: { id: string; title: string; summary: string; severity: Severity }) {
  return (
    <Dialog
      title="Edit incident"
      description="Fix a typo or change how serious it is. This doesn't notify anyone. To tell people what's changed, post an update."
      trigger={
        <Button variant="outline" size="sm">
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </Button>
      }
    >
      <ActionForm action={editIncident} className="space-y-4" resetOnSuccess={false}>
        <input type="hidden" name="id" value={id} />
        <DetailsFields idPrefix="edit" title={title} summary={summary} severity={severity} />
        <div className="flex justify-end pt-1">
          <SubmitButton>Save changes</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function PostUpdateForm({ id, status, notifyCount, reopen }: { id: string; status: string; notifyCount: number; reopen: boolean }) {
  const current = (UPDATE_STATUSES as readonly string[]).includes(status) ? status : "investigating";
  return (
    <ActionForm action={postIncidentUpdate} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <fieldset>
        <legend className="mb-1.5 block text-xs font-medium text-slate-600">Where do things stand?</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {UPDATE_STATUSES.map((s) => (
            <label
              key={s}
              htmlFor={`upd-${s}`}
              className="flex cursor-pointer gap-2 rounded-lg border border-slate-200 p-2.5 transition-colors hover:bg-slate-50 has-[:checked]:border-primary-300 has-[:checked]:bg-primary-50"
            >
              <input id={`upd-${s}`} type="radio" name="status" value={s} defaultChecked={s === current} className="mt-0.5 h-4 w-4 accent-primary-600" />
              <span>
                <span className="block text-sm font-medium text-slate-800">{INCIDENT_STATUS_META[s].label}</span>
                <span className="block text-xs leading-snug text-slate-500">{INCIDENT_STATUS_META[s].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Message" htmlFor="upd-body" required>
        <Textarea
          id="upd-body"
          name="body"
          required
          maxLength={2000}
          rows={3}
          placeholder={reopen ? "e.g. The problem is back for some people. We're looking into it again." : "e.g. We found the cause and expect a fix within the hour."}
        />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          {notifyCount > 0 ? `${peopleCount(notifyCount)} will get this as a notification.` : "Shows on the Service status page. Nobody has asked for notifications yet."}
        </p>
        <SubmitButton>
          <Send className="h-4 w-4" aria-hidden />
          {reopen ? "Reopen and post" : "Post update"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ResolveIncidentDialog({ id, openTickets, notifyCount }: { id: string; openTickets: number; notifyCount: number }) {
  return (
    <Dialog
      title="Resolve incident"
      description="Marks it fixed on the Service status page and tells everyone who's affected."
      trigger={
        <Button variant="success" size="sm">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Resolve incident
        </Button>
      }
    >
      <ActionForm action={resolveIncident} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <Field label="What was fixed?" htmlFor="resolve-msg" required hint="Say if people need to do anything, like restart or sign in again.">
          <Textarea id="resolve-msg" name="message" required maxLength={2000} rows={4} placeholder="e.g. Email is working again. Messages sent during the outage will arrive in the next few minutes." />
        </Field>
        {openTickets > 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <Checkbox
              name="resolve_tickets"
              defaultChecked
              label={
                <span>
                  Also resolve the {openTickets} linked open {openTickets === 1 ? "ticket" : "tickets"} and tell {openTickets === 1 ? "its requester" : "their requesters"}
                </span>
              }
            />
            <p className="mt-1 pl-6 text-xs text-slate-500">Your message is added to each ticket as a reply.</p>
          </div>
        ) : (
          <input type="hidden" name="resolve_tickets" value="0" />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">{notifyCount > 0 ? `${peopleCount(notifyCount)} will be notified.` : "Nobody is waiting on notifications."}</p>
          <SubmitButton variant="success">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Resolve incident
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function LinkTicketsForm({ id }: { id: string }) {
  return (
    <ActionForm action={linkTickets} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="id" value={id} />
      <div className="flex-1">
        <label htmlFor="link-numbers" className="sr-only">
          Ticket numbers
        </label>
        <div className="relative">
          <Link2 aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input id="link-numbers" name="numbers" required placeholder="SD-1104, SD-1105" autoComplete="off" className="pl-9" maxLength={600} />
        </div>
        <p className="mt-1 text-xs text-slate-500">Ticket numbers, separated by commas. Their requesters get every update.</p>
      </div>
      <SubmitButton variant="secondary">
        <Plus className="h-4 w-4" aria-hidden />
        Link tickets
      </SubmitButton>
    </ActionForm>
  );
}
