import Link from "next/link";
import { Building2, Mail, MapPin, Phone, UserRound } from "lucide-react";
import { Avatar, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { SlaBadge, TicketStatusBadge } from "@/components/tickets/badges";
import { APPROVAL_META, ASSET_STATUSES, type CatalogField, ticketRef } from "@/lib/constants";
import { formatDuration, formatTarget, type SlaState } from "@/lib/sla";
import { cn, formatDate, formatDateTime, humanize } from "@/lib/utils";
import type { ApprovalView, Person } from "@/lib/tickets/load";

/**
 * True when a catalog request's description is just its answers written out
 * (what the catalog stores when the requester adds no note), so the agent
 * view can show the answers table once instead of twice.
 */
export function isGeneratedDescription(description: string, fields: unknown, data: unknown) {
  if (!data || typeof data !== "object") return false;
  const labels = (Array.isArray(fields) ? fields : [])
    .map((f) => (f && typeof f === "object" ? String((f as CatalogField).label ?? "") : ""))
    .filter(Boolean)
    .map((l) => l.toLowerCase());
  const keys = Object.keys(data as Record<string, unknown>).map((k) => humanize(k).toLowerCase());
  const known = [...labels, ...keys];
  const lines = description.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return true;
  if (lines.length === 1 && /^requested “.+” from the service catalog\.$/i.test(lines[0])) return true;
  return lines.every((l) => {
    const m = /^(?:[-*]\s*)?\*\*(.+?)\*\*/.exec(l);
    if (!m) return false;
    const norm = (v: string) => v.replace(/[:?\s]+$/, "").trim().toLowerCase();
    const label = norm(m[1]);
    return known.some((k) => norm(k) === label);
  });
}

/** Catalog request answers, labelled with the catalog item's field definitions. */
export function FormAnswers({ fields, data, first = false }: { fields: unknown; data: unknown; first?: boolean }) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const values = data as Record<string, unknown>;
  const defs = (Array.isArray(fields) ? fields : []).filter((f): f is CatalogField => !!f && typeof f === "object" && typeof (f as CatalogField).key === "string");
  const known = new Set(defs.map((f) => f.key));
  const rows = [
    ...defs.filter((f) => f.key in values).map((f) => ({ key: f.key, label: f.label || humanize(f.key), type: f.type, value: values[f.key] })),
    ...Object.keys(values)
      .filter((k) => !known.has(k))
      .map((k) => ({ key: k, label: humanize(k), type: undefined, value: values[k] })),
  ];
  if (!rows.length) return null;

  const show = (type: string | undefined, v: unknown) => {
    if (v === null || v === undefined || v === "") return <span className="text-slate-400">—</span>;
    if (type === "checkbox" || typeof v === "boolean") return v === true || v === "true" || v === "on" ? "Yes" : "No";
    if (type === "date" && typeof v === "string") return formatDate(v);
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-slate-50/60", !first && "mt-4")}>
      <p className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Request details</p>
      <dl className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.key} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,12rem)_1fr] sm:gap-3">
            <dt className="text-xs font-medium text-slate-500 sm:text-sm">{r.label}</dt>
            <dd className="whitespace-pre-wrap break-words text-slate-800">{show(r.type, r.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type OpenTicket = { id: string; number: number; subject: string; status: string };
type AssetLite = { id: string; asset_tag: string; name: string; status: string };

export function RequesterCard({
  person,
  managerName,
  openTickets,
  assets,
  linkAssets,
}: {
  person: Person | null;
  managerName: string | null;
  openTickets: OpenTicket[];
  assets: AssetLite[] | null;
  linkAssets: boolean;
}) {
  if (!person) {
    return (
      <Card>
        <CardHeader title="Requester" />
        <CardBody className="text-sm text-slate-500">This person is no longer an employee.</CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Requester" />
      <CardBody className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={person.full_name} src={person.avatar_url} size="md" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{person.full_name ?? person.email}</p>
            <p className="truncate text-xs text-slate-500">
              {person.designation ?? "—"}
              {person.employee_code && <span className="text-slate-400"> · {person.employee_code}</span>}
            </p>
          </div>
        </div>
        <ul className="space-y-1.5 text-xs text-slate-600">
          {person.department && (
            <li className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" /> {person.department}
            </li>
          )}
          {person.location && (
            <li className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" /> {person.location}
            </li>
          )}
          <li className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <a href={`mailto:${person.email}`} className="truncate hover:text-primary-600">
              {person.email}
            </a>
          </li>
          {person.phone && (
            <li className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <a href={`tel:${person.phone.replace(/\s/g, "")}`} className="hover:text-primary-600">
                {person.phone}
              </a>
            </li>
          )}
          <li className="flex items-center gap-2">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" /> Manager: {managerName ?? "—"}
          </li>
        </ul>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Other open tickets</p>
          {openTickets.length ? (
            <ul className="space-y-1">
              {openTickets.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-xs">
                  <Link href={`/desk/tickets/${t.number}`} className="shrink-0 font-mono font-semibold text-primary-600 hover:underline">
                    {ticketRef(t.number)}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-slate-600" title={t.subject}>
                    {t.subject}
                  </span>
                  <TicketStatusBadge status={t.status} className="px-1.5 text-[10px]" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">None</p>
          )}
        </div>

        {assets && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned assets</p>
            {assets.length ? (
              <ul className="space-y-1">
                {assets.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-xs">
                    {linkAssets ? (
                      <Link href={`/desk/assets/${a.id}`} className="shrink-0 font-mono font-semibold text-primary-600 hover:underline">
                        {a.asset_tag}
                      </Link>
                    ) : (
                      <span className="shrink-0 font-mono font-semibold text-slate-700">{a.asset_tag}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-slate-600">{a.name}</span>
                    {ASSET_STATUSES[a.status] && a.status !== "assigned" && (
                      <Badge tone={ASSET_STATUSES[a.status].tone} className="px-1.5 text-[10px]">
                        {ASSET_STATUSES[a.status].label}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">None</p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function SlaCard({
  response,
  resolution,
  policy,
  respondedAt,
  resolvedAt,
  pausedMinutes,
  pendingSince,
}: {
  response: SlaState;
  resolution: SlaState;
  policy: { first_response_mins: number; resolution_mins: number } | null;
  respondedAt: string | null;
  resolvedAt: string | null;
  pausedMinutes: number;
  pendingSince: string | null;
}) {
  const row = (label: string, state: SlaState, target: number | undefined, doneLabel: string, doneAt: string | null) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <SlaBadge state={state} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-slate-400">Target</dt>
        <dd className="text-right text-slate-700">{target ? `${formatTarget(target)} working time` : "—"}</dd>
        <dt className="text-slate-400">Due</dt>
        <dd className="text-right text-slate-700">{state.due ? formatDateTime(state.due) : "—"}</dd>
        {doneAt && (
          <>
            <dt className="text-slate-400">{doneLabel}</dt>
            <dd className="text-right text-slate-700">{formatDateTime(doneAt)}</dd>
          </>
        )}
      </dl>
    </div>
  );

  return (
    <Card>
      <CardHeader title="SLA" description="Counted in business hours; time waiting on the requester doesn't count." />
      <CardBody className="space-y-4">
        {row("First response", response, policy?.first_response_mins, "Responded", respondedAt)}
        <div className="border-t border-slate-100" />
        {row("Resolution", resolution, policy?.resolution_mins, "Resolved", resolvedAt)}
        {(pausedMinutes > 0 || pendingSince) && (
          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
            {pausedMinutes > 0 && <>Paused for {formatDuration(pausedMinutes)} of working time so far. </>}
            {pendingSince && <>Paused since {formatDateTime(pendingSince)}.</>}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export function approverName(a: ApprovalView) {
  if (a.kind === "manager") return a.approver?.full_name ?? "the requester's manager";
  return `${a.team?.name ?? "the team"} leads`;
}

export function ApprovalsCard({ approvals }: { approvals: ApprovalView[] }) {
  if (!approvals.length) return null;
  return (
    <Card>
      <CardHeader title="Approvals" />
      <CardBody className="space-y-3">
        {approvals.map((a) => {
          const meta = APPROVAL_META[a.status];
          return (
            <div key={a.id} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">
                  {a.kind === "manager" ? "Manager" : "Team lead"}: <span className="font-normal">{approverName(a)}</span>
                </span>
                {meta && <Badge tone={meta.tone}>{meta.label === "Awaiting approval" ? "Waiting" : meta.label}</Badge>}
              </div>
              <p className="mt-0.5 text-slate-400">
                {a.status === "cancelled" && a.decided_at
                  ? `Withdrawn · ${formatDateTime(a.decided_at)}`
                  : a.decided_at
                    ? `${humanize(a.status)} by ${a.decider?.full_name ?? "—"} · ${formatDateTime(a.decided_at)}`
                    : `Asked ${formatDateTime(a.created_at)}`}
              </p>
              {a.comment && <p className="mt-1 rounded-md bg-slate-50 px-2 py-1.5 text-slate-600">“{a.comment}”</p>}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
