import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightLeft, CircleDot, History, Mail, Pencil, PlusCircle, Ticket, UserMinus, UserPlus, UserX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requireAssetManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSET_STATUSES, ticketRef } from "@/lib/constants";
import { Avatar, Card, CardBody, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { TicketStatusBadge } from "@/components/tickets/badges";
import { formatCurrency, formatDate, formatDateTime, humanize } from "@/lib/utils";
import { HOLDER_SELECT, fetchPeople, personOptions, type AssetListRow } from "../_lib/data";
import { UUID_RE } from "../_lib/shared";
import { AssetStatusBadge, WarrantyDate, assetTypeLabel } from "../_components/bits";
import { AssetQuickActions } from "../_components/asset-actions";

export const metadata = { title: "Asset" };

type AssetEvent = { id: string; kind: string; details: string | null; created_at: string; actor: { full_name: string | null } | null };
type LinkedTicket = { id: string; number: number; subject: string; status: string; created_at: string; requester: { full_name: string | null } | null };

const statusLabel = (s: string) => ASSET_STATUSES[s.trim()]?.label ?? humanize(s.trim());

function describeEvent(e: AssetEvent): { icon: LucideIcon; text: string; tone: string } {
  switch (e.kind) {
    case "created":
      return { icon: PlusCircle, text: "Added to the register", tone: "bg-primary-50 text-primary-600" };
    case "assigned":
      return { icon: UserPlus, text: `Assigned to ${e.details ?? "someone"}`, tone: "bg-blue-50 text-blue-600" };
    case "unassigned":
      return { icon: UserMinus, text: `Taken back from ${e.details ?? "the holder"}`, tone: "bg-slate-100 text-slate-600" };
    case "status": {
      const [from, to] = (e.details ?? "").split("→");
      return {
        icon: ArrowRightLeft,
        text: from && to ? `Status changed from ${statusLabel(from)} to ${statusLabel(to)}` : "Status changed",
        tone: "bg-amber-50 text-amber-700",
      };
    }
    default:
      return { icon: CircleDot, text: [humanize(e.kind), e.details].filter(Boolean).join(": "), tone: "bg-slate-100 text-slate-600" };
  }
}

function Detail({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

const dash = <span className="text-slate-400">—</span>;

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAssetManager();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();

  const [{ data: assetData }, { data: eventData }, { data: ticketData }, people] = await Promise.all([
    supabase.from("assets").select(`*, ${HOLDER_SELECT}`).eq("id", id).maybeSingle(),
    supabase.from("asset_events").select("id, kind, details, created_at, actor:people!actor_id(full_name)").eq("asset_id", id).order("created_at", { ascending: false }).limit(100),
    supabase
      .from("tickets")
      .select("id, number, subject, status, created_at, requester:people!requester_id(full_name)")
      .eq("asset_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    fetchPeople(supabase),
  ]);
  if (!assetData) notFound();
  const asset = assetData as unknown as AssetListRow;
  const events = (eventData ?? []) as unknown as AssetEvent[];
  const tickets = (ticketData ?? []) as unknown as LinkedTicket[];

  const { data: location } = asset.location_id
    ? await supabase.schema("public").from("locations").select("name").eq("id", asset.location_id).maybeSingle()
    : { data: null };

  const holder = asset.holder;
  const heldSince = holder ? events.find((e) => e.kind === "assigned")?.created_at : null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{asset.asset_tag}</span>
            <AssetStatusBadge status={asset.status} />
          </span>
        }
        description={`${asset.name} · ${assetTypeLabel(asset.type)}`}
        breadcrumbs={[{ label: "Assets", href: "/desk/assets" }, { label: asset.asset_tag }]}
        actions={
          <Link href={`/desk/assets/${id}/edit`} className={buttonClass("outline")}>
            <Pencil className="h-4 w-4" /> Edit
          </Link>
        }
      />

      <Card className="mb-6">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">Quick actions</p>
          <AssetQuickActions id={id} tag={asset.asset_tag} status={asset.status} holderId={holder?.id ?? asset.assigned_to} holderName={holder?.full_name ?? null} people={personOptions(people)} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Detail label="Name">{asset.name}</Detail>
                <Detail label="Type">{assetTypeLabel(asset.type)}</Detail>
                <Detail label="Manufacturer">{asset.manufacturer ?? dash}</Detail>
                <Detail label="Model">{asset.model ?? dash}</Detail>
                <Detail label="Serial number">{asset.serial_number ? <span className="font-mono text-[13px]">{asset.serial_number}</span> : dash}</Detail>
                <Detail label="Location">{location?.name ?? dash}</Detail>
                <Detail label="Purchase date">{asset.purchase_date ? formatDate(asset.purchase_date) : dash}</Detail>
                <Detail label="Purchase cost">{asset.purchase_cost != null ? formatCurrency(asset.purchase_cost, 2) : dash}</Detail>
                <Detail label="Vendor">{asset.vendor ?? dash}</Detail>
                <Detail label="Warranty until">
                  <WarrantyDate until={asset.warranty_until} withHint />
                </Detail>
                <Detail label="Added">{formatDate(asset.created_at)}</Detail>
                <Detail label="Last changed">{formatDateTime(asset.updated_at)}</Detail>
                {asset.notes && (
                  <Detail label="Notes" wide>
                    <p className="whitespace-pre-wrap">{asset.notes}</p>
                  </Detail>
                )}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Linked tickets" description="Tickets raised about this asset." />
            {tickets.length === 0 ? (
              <EmptyState icon={Ticket} title="No tickets about this asset" description="When someone links this asset to a ticket, it shows up here." className="py-8" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/desk/tickets/${t.number}`} className="flex flex-col gap-1 px-5 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4">
                      <span className="w-20 shrink-0 font-mono text-xs font-semibold text-primary-700">{ticketRef(t.number)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{t.subject}</span>
                        <span className="block text-xs text-slate-500">
                          {t.requester?.full_name ?? "Unknown"} · {formatDate(t.created_at)}
                        </span>
                      </span>
                      <TicketStatusBadge status={t.status} className="self-start sm:self-center" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Current holder" />
            <CardBody>
              {holder ? (
                <div className="flex items-start gap-3">
                  <Avatar name={holder.full_name} src={holder.avatar_url} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{holder.full_name}</p>
                    {(holder.designation || holder.department) && <p className="text-xs text-slate-500">{[holder.designation, holder.department].filter(Boolean).join(" · ")}</p>}
                    <a href={`mailto:${holder.email}`} className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-primary-700 hover:underline">
                      <Mail className="h-3 w-3 shrink-0" /> {holder.email}
                    </a>
                    {heldSince && <p className="mt-2 text-xs text-slate-500">Has it since {formatDate(heldSince)}</p>}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                    <UserX className="h-5 w-5" />
                  </span>
                  Nobody has this asset right now.
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Every change, newest first." />
            <CardBody>
              {events.length === 0 ? (
                <EmptyState icon={History} title="No history yet" className="py-6" />
              ) : (
                <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-slate-200">
                  {events.map((e) => {
                    const d = describeEvent(e);
                    return (
                      <li key={e.id} className="relative flex gap-3">
                        <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${d.tone}`}>
                          <d.icon className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <p className="text-sm text-slate-800">{d.text}</p>
                          <p className="text-xs text-slate-500">
                            {e.actor?.full_name ?? "System"} · <time dateTime={e.created_at}>{formatDateTime(e.created_at)}</time>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
