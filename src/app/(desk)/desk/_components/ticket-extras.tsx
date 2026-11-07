"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { GitMerge, Loader2, Search, Siren, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Avatar, Button, Card, CardBody, CardHeader, Input, Select } from "@/components/ui";
import { ActionButton } from "@/components/ui/action-button";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Dialog } from "@/components/ui/dialog";
import { TicketStatusBadge } from "@/components/tickets/badges";
import { ticketRef } from "@/lib/constants";
import { addFollower, lookupTicket, mergeTicket, removeFollower, searchPeople, setIncident, type PersonHit, type TicketLookup } from "../actions";
import { ShortcutsHelp, TICKET_SHORTCUTS, clickShortcut } from "./shortcuts";

/** Ticket page hotkeys: a = assign to me, Shift+E = resolve, ? = help (r / n live in the Composer). */
export function TicketHotkeys() {
  return (
    <ShortcutsHelp
      shortcuts={TICKET_SHORTCUTS}
      extra={{
        a: () => {
          if (!clickShortcut("assign")) toast.message("This ticket is already yours");
        },
        "Shift+E": () => {
          if (!clickShortcut("resolve")) toast.message("This ticket can't be resolved right now");
        },
      }}
    />
  );
}

/** "Merge into…": type a ticket number, confirm its subject, then merge this ticket into it. */
export function MergeDialog({ ticketId, ticketNumber }: { ticketId: string; ticketNumber: number }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<TicketLookup | null>(null);
  const [looking, startLookup] = useTransition();

  const find = () => {
    const value = input.trim();
    if (!value) return;
    startLookup(async () => {
      const r = await lookupTicket(value);
      setResult(r.ok && r.ticket.id === ticketId ? { ok: false, error: "That's this ticket. Choose the one to keep." } : r);
    });
  };

  const target = result?.ok ? result.ticket : null;
  const closed = target?.status === "closed";

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <GitMerge className="h-3.5 w-3.5" /> Merge
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setInput("");
            setResult(null);
          }
        }}
        title={`Merge ${ticketRef(ticketNumber)} into another ticket`}
        description="Use this for duplicates. This ticket will be closed, its requester will follow the ticket you keep, and both get a note."
      >
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <label htmlFor="merge-target" className="sr-only">
            Ticket number to keep
          </label>
          <Input
            id="merge-target"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setResult(null);
            }}
            placeholder="Ticket to keep, e.g. SD-1042"
            autoFocus
            autoComplete="off"
            inputMode="text"
          />
          <Button type="submit" variant="outline" disabled={looking || !input.trim()}>
            {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find
          </Button>
        </form>
        {result && !result.ok && <p className="mt-3 text-sm text-red-600">{result.error}</p>}
        {target && (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-semibold text-slate-700">{ticketRef(target.number)}</span>
                <TicketStatusBadge status={target.status} />
                {target.team && <span className="text-slate-500">{target.team}</span>}
              </div>
              <p className="mt-1 text-sm font-medium text-slate-800">{target.subject}</p>
            </div>
            {closed ? (
              <p className="text-sm text-red-600">That ticket is closed. Reopen it first, or choose another one.</p>
            ) : (
              <ActionForm action={mergeTicket} resetOnSuccess={false} className="flex justify-end gap-2">
                <input type="hidden" name="ticket_id" value={ticketId} />
                <input type="hidden" name="target_id" value={target.id} />
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <SubmitButton>
                  <GitMerge className="h-4 w-4" /> Merge into {ticketRef(target.number)}
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

type IncidentOption = { id: string; title: string; status: string; severity: string };

/** Link this ticket to an active incident of its team (or unlink it). */
export function IncidentCard({ ticketId, linked, active }: { ticketId: string; linked: IncidentOption | null; active: IncidentOption[] }) {
  const options = active.filter((i) => i.id !== linked?.id);
  return (
    <Card>
      <CardHeader title="Incident" description={linked ? undefined : "Link tickets caused by the same outage so everyone gets its updates."} />
      <CardBody className="space-y-3">
        {linked && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50/60 px-3 py-2.5">
            <Siren className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <Link href="/desk/incidents" className="block text-sm font-medium text-slate-800 hover:text-primary-600">
                {linked.title}
              </Link>
              <p className="text-xs text-slate-500">
                {linked.status === "resolved" ? "Resolved" : `${linked.severity === "major" ? "Major" : "Minor"} · ${linked.status.charAt(0).toUpperCase()}${linked.status.slice(1)}`}
              </p>
            </div>
            <ActionButton action={setIncident} fields={{ ticket_id: ticketId, incident_id: "" }} variant="ghost" size="sm" className="h-7 px-2">
              Unlink
            </ActionButton>
          </div>
        )}
        {options.length > 0 ? (
          <ActionForm action={setIncident} className="flex gap-2">
            <input type="hidden" name="ticket_id" value={ticketId} />
            <label htmlFor="incident-pick" className="sr-only">
              Active incident
            </label>
            <Select id="incident-pick" name="incident_id" required defaultValue="" className="min-w-0 flex-1">
              <option value="" disabled>
                {linked ? "Move to another incident…" : "Choose an active incident…"}
              </option>
              {options.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title} · {i.status.charAt(0).toUpperCase() + i.status.slice(1)}
                </option>
              ))}
            </Select>
            <SubmitButton variant="outline" size="md">
              Link
            </SubmitButton>
          </ActionForm>
        ) : (
          !linked && <p className="text-xs text-slate-400">No active incidents for this team.</p>
        )}
      </CardBody>
    </Card>
  );
}

type Follower = { id: string; full_name: string | null; email: string; avatar_url: string | null };

/** Followers (CC): colleagues who can see the ticket, reply, and get public updates. */
export function FollowersCard({ ticketId, followers, requesterId, canEdit }: { ticketId: string; followers: Follower[]; requesterId: string; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardHeader
        title={`Followers${followers.length ? ` (${followers.length})` : ""}`}
        action={
          canEdit && !adding && followers.length < 20 ? (
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Add
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-3">
        {adding && <PeoplePicker ticketId={ticketId} exclude={[requesterId, ...followers.map((f) => f.id)]} onDone={() => setAdding(false)} />}
        {followers.length ? (
          <ul className="space-y-2">
            {followers.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5">
                <Avatar name={f.full_name ?? f.email} src={f.avatar_url} size="xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">{f.full_name ?? f.email}</p>
                  <p className="truncate text-xs text-slate-500">{f.email}</p>
                </div>
                {canEdit && (
                  <ActionButton action={removeFollower} fields={{ ticket_id: ticketId, employee_id: f.id }} variant="ghost" size="sm" className="h-7 w-7 px-0" title={`Remove ${f.full_name ?? f.email}`}>
                    <X className="h-3.5 w-3.5" />
                    <span className="sr-only">Remove {f.full_name ?? f.email}</span>
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        ) : (
          !adding && <p className="text-xs text-slate-400">Nobody else is following. Add a colleague who should see updates, like their manager.</p>
        )}
      </CardBody>
    </Card>
  );
}

function PeoplePicker({ ticketId, exclude, onDone }: { ticketId: string; exclude: string[]; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, startSaving] = useTransition();
  const router = useRouter();
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      searchPeople(term)
        .then((r) => live && setHits(r))
        .finally(() => live && setBusy(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  const shown = term.length < 2 ? [] : hits.filter((h) => !exclude.includes(h.id));
  const add = (p: PersonHit) =>
    startSaving(async () => {
      const fd = new FormData();
      fd.set("ticket_id", ticketId);
      fd.set("employee_id", p.id);
      const res = await addFollower(null, fd);
      if (res?.ok) {
        toast.success(`${p.full_name ?? p.email} is now following`);
        onDone();
        router.refresh();
      } else if (res?.error) toast.error(res.error);
    });

  return (
    <div
      className="rounded-lg border border-slate-200 p-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <div className="flex gap-1.5">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="follower-q" className="sr-only">
            Find a colleague
          </label>
          <Input id="follower-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" autoFocus autoComplete="off" className="h-8 pr-7 text-xs" />
          {(busy || saving) && <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />}
        </div>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {term.length >= 2 && (
        <ul className="mt-1.5 max-h-56 overflow-y-auto">
          {shown.length ? (
            shown.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={saving} onClick={() => add(p)} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-50 focus:bg-primary-50 focus:outline-none disabled:opacity-50">
                  <span className="block truncate text-sm text-slate-800">{p.full_name ?? p.email}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {p.email}
                    {p.department ? ` · ${p.department}` : ""}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-2 py-2 text-xs text-slate-400">{busy ? "Searching…" : "No colleagues match."}</li>
          )}
        </ul>
      )}
    </div>
  );
}
