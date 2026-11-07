"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, Button, Label, Select, Table, TBody, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { ActionButton } from "@/components/ui/action-button";
import { Dialog } from "@/components/ui/dialog";
import { ApprovalBadge, PriorityDot, SlaBadge, TicketStatusBadge } from "@/components/tickets/badges";
import { PRIORITIES, PRIORITY_META, ticketRef } from "@/lib/constants";
import type { SlaState } from "@/lib/sla";
import { cn } from "@/lib/utils";
import { assignToMe, bulkUpdate } from "../actions";
import { useHotkeys } from "./shortcuts";
import { TeamChip } from "./team-chip";

export type QueueRowView = {
  id: string;
  number: number;
  subject: string;
  requester: string;
  department: string | null;
  team: { name: string; color: string } | null;
  priority: string;
  status: string;
  approvalPending: boolean;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  canTake: boolean;
  sla: SlaState;
  updated: string;
  updatedTitle: string;
};

type Option = { id: string; name: string };

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending (ask the requester)" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
] as const;

/** Queue rows with selection, a bulk action bar and j / k / Enter / x keyboard navigation. */
export function QueueTable({ rows, meId, showTeam, agents, incidents }: { rows: QueueRowView[]; meId: string; showTeam: boolean; agents: Option[]; incidents: Option[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(-1);
  const [pending, startTransition] = useTransition();
  const [noteFor, setNoteFor] = useState<null | "pending" | "resolved">(null);
  const [note, setNote] = useState("");
  const allRef = useRef<HTMLInputElement>(null);

  // Drop selections that are no longer on the page (after a refresh or page change).
  const ids = rows.map((r) => r.id).join(",");
  const [prevIds, setPrevIds] = useState(ids);
  if (prevIds !== ids) {
    setPrevIds(ids);
    setSelected((cur) => new Set([...cur].filter((id) => rows.some((r) => r.id === id))));
    setCursor((c) => Math.min(c, rows.length - 1));
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const move = (delta: number) => {
    if (!rows.length) return;
    const next = cursor < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, cursor + delta));
    setCursor(next);
    document.querySelector(`[data-queue-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };

  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    Enter: () => {
      if (rows[cursor]) router.push(`/desk/tickets/${rows[cursor].number}`);
    },
    x: () => {
      if (rows[cursor]) toggle(rows[cursor].id);
    },
    Escape: () => {
      if (selected.size) setSelected(new Set());
      else setCursor(-1);
    },
  });

  const run = (op: "assign" | "status" | "priority" | "incident", value: string, message?: string) => {
    const fd = new FormData();
    selected.forEach((id) => fd.append("ids", id));
    fd.set("op", op);
    fd.set("value", value);
    if (message) fd.set("note", message);
    startTransition(async () => {
      const res = await bulkUpdate(null, fd);
      if (res?.ok) {
        toast.success(res.message ?? "Updated");
        setSelected(new Set());
        setNoteFor(null);
        setNote("");
        router.refresh();
      } else if (res?.error) {
        toast.error(res.error);
      }
    });
  };

  const checkbox = (r: QueueRowView) => (
    <input
      type="checkbox"
      checked={selected.has(r.id)}
      onChange={() => toggle(r.id)}
      aria-label={`Select ${ticketRef(r.number)}`}
      className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
    />
  );

  const assigneeCell = (r: QueueRowView) =>
    r.assignee ? (
      <span className="inline-flex items-center gap-2 text-xs text-slate-700">
        <Avatar name={r.assignee.name} src={r.assignee.avatarUrl} size="xs" />
        {r.assignee.id === meId ? "Me" : r.assignee.name}
      </span>
    ) : (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-slate-400">Unassigned</span>
        {r.canTake && (
          <ActionButton action={assignToMe} fields={{ ticket_id: r.id }} variant="secondary" size="sm" className="h-6 px-2 text-[11px]">
            Take it
          </ActionButton>
        )}
      </span>
    );

  return (
    <>
      <div className="flex items-center justify-end gap-1 px-2 pb-1 md:hidden">
        <label className="inline-flex items-center gap-2 px-2 py-1 text-xs text-slate-600">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300 text-primary-600" />
          Select all
        </label>
      </div>

      {/* Phones: stacked rows */}
      <ul className="divide-y divide-slate-100 border-t border-slate-100 md:hidden">
        {rows.map((r, i) => (
          <li key={r.id} data-queue-row={i} className={cn("flex gap-3 px-4 py-3", selected.has(r.id) && "bg-primary-50/50")}>
            <div className="pt-0.5">{checkbox(r)}</div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Link href={`/desk/tickets/${r.number}`} className="block">
                <span className="font-mono text-xs font-semibold text-primary-600">{ticketRef(r.number)}</span>
                <span className="ml-2 font-medium text-slate-800">{r.subject}</span>
              </Link>
              <p className="truncate text-xs text-slate-500">
                {r.requester}
                {r.department && <span className="text-slate-400"> · {r.department}</span>}
                <span className="text-slate-400"> · {r.updated}</span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <TicketStatusBadge status={r.status} audience="agent" />
                {r.approvalPending && <ApprovalBadge status="pending" />}
                <PriorityDot priority={r.priority} />
                <SlaBadge state={r.sla} />
                {showTeam && r.team && <TeamChip name={r.team.name} color={r.team.color} />}
              </div>
              <div>{assigneeCell(r)}</div>
            </div>
          </li>
        ))}
      </ul>

      {/* Tablets and up: table */}
      <div className="hidden md:block">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="w-10 pr-0">
                <input
                  ref={allRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all tickets on this page"
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
              </TH>
              <TH>Ref</TH>
              <TH className="min-w-[14rem]">Subject</TH>
              {showTeam && <TH className="hidden 2xl:table-cell">Team</TH>}
              <TH>Priority</TH>
              <TH>Status</TH>
              <TH>Assignee</TH>
              <TH>SLA</TH>
              <TH className="hidden 2xl:table-cell">Updated</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => {
              const href = `/desk/tickets/${r.number}`;
              return (
                <TR
                  key={r.id}
                  data-queue-row={i}
                  aria-current={cursor === i ? "true" : undefined}
                  className={cn(selected.has(r.id) && "bg-primary-50/50", cursor === i && "outline outline-2 -outline-offset-2 outline-primary-400")}
                >
                  <TD className="w-10 py-2.5 pr-0">{checkbox(r)}</TD>
                  <TD className="whitespace-nowrap py-2.5">
                    <Link href={href} className="font-mono text-xs font-semibold text-primary-600 hover:underline">
                      {ticketRef(r.number)}
                    </Link>
                  </TD>
                  <TD className="max-w-[28rem] py-2.5">
                    <Link href={href} className="line-clamp-1 font-medium text-slate-800 hover:text-primary-600" title={r.subject}>
                      {r.subject}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {showTeam && r.team && (
                        <span className="mr-1.5 inline-flex items-center gap-1 font-medium 2xl:hidden" style={{ color: r.team.color }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.team.color }} />
                          {r.team.name} ·
                        </span>
                      )}
                      {r.requester}
                      {r.department && <span className="text-slate-400"> · {r.department}</span>}
                      <span className="text-slate-400 2xl:hidden" title={r.updatedTitle}>
                        {" "}
                        · {r.updated}
                      </span>
                    </p>
                  </TD>
                  {showTeam && <TD className="hidden whitespace-nowrap py-2.5 2xl:table-cell">{r.team ? <TeamChip name={r.team.name} color={r.team.color} /> : "—"}</TD>}
                  <TD className="whitespace-nowrap py-2.5">
                    <PriorityDot priority={r.priority} />
                  </TD>
                  <TD className="whitespace-nowrap py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <TicketStatusBadge status={r.status} audience="agent" />
                      {r.approvalPending && <ApprovalBadge status="pending" />}
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap py-2.5">{assigneeCell(r)}</TD>
                  <TD className="whitespace-nowrap py-2.5">
                    <SlaBadge state={r.sla} />
                  </TD>
                  <TD className="hidden whitespace-nowrap py-2.5 text-xs text-slate-500 2xl:table-cell" title={r.updatedTitle}>
                    {r.updated}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      <div className="sr-only" aria-live="polite">
        {selected.size ? `${selected.size} ticket${selected.size === 1 ? "" : "s"} selected` : ""}
      </div>

      {selected.size > 0 && (
        <div role="toolbar" aria-label="Bulk actions" className="fixed inset-x-3 bottom-3 z-40 rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xl sm:inset-x-6 lg:left-[calc(264px+2rem)] lg:right-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-1 text-sm font-semibold text-slate-800">
              {pending && <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />}
              {selected.size} selected
            </span>
            <BulkSelect label="Assign to" disabled={pending} onPick={(v) => run("assign", v)}>
              <option value="me">Me</option>
              <option value="unassigned">Unassigned</option>
              {agents
                .filter((a) => a.id !== meId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </BulkSelect>
            <BulkSelect
              label="Set status"
              disabled={pending}
              onPick={(v) => {
                if (v === "pending" || v === "resolved") setNoteFor(v);
                else run("status", v);
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </BulkSelect>
            <BulkSelect label="Set priority" disabled={pending} onPick={(v) => run("priority", v)}>
              {[...PRIORITIES].reverse().map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </BulkSelect>
            <BulkSelect label="Link to incident" disabled={pending} onPick={(v) => run("incident", v)}>
              {incidents.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
              <option value="none">Unlink from incident</option>
            </BulkSelect>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setSelected(new Set())} disabled={pending}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={noteFor !== null}
        onOpenChange={(o) => {
          if (!o) setNoteFor(null);
        }}
        title={noteFor === "resolved" ? `Resolve ${selected.size} ticket${selected.size === 1 ? "" : "s"}` : `Ask ${selected.size === 1 ? "the requester" : "the requesters"}`}
        size="sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (noteFor && note.trim()) run("status", noteFor, note.trim());
          }}
        >
          <Label htmlFor="bulk-note" required>
            {noteFor === "resolved" ? "Resolution note (sent to each requester as a reply)" : "Your question (sent to each requester). The SLA pauses until they answer."}
          </Label>
          <Textarea id="bulk-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus maxLength={20000} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNoteFor(null)}>
              Cancel
            </Button>
            <Button type="submit" variant={noteFor === "resolved" ? "success" : "primary"} disabled={pending || !note.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {noteFor === "resolved" ? "Resolve" : "Mark pending"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** A select that runs `onPick` and snaps back to its label. */
function BulkSelect({ label, disabled, onPick, children }: { label: string; disabled?: boolean; onPick: (value: string) => void; children: React.ReactNode }) {
  return (
    <Select
      aria-label={label}
      value=""
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
      className="h-8 w-auto min-w-[8rem] flex-1 text-xs lg:max-w-[12rem]"
    >
      <option value="" disabled>
        {label}…
      </option>
      {children}
    </Select>
  );
}
