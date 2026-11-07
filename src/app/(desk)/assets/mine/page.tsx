import Link from "next/link";
import { ChevronRight, Laptop, MessageSquarePlus } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ticketRef } from "@/lib/constants";
import { formatDate, orgToday } from "@/lib/utils";
import { Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { TicketStatusBadge } from "@/components/tickets/badges";
import { AssetCard, warrantyState, type MyAsset } from "./_components/asset-card";

export const metadata = { title: "My assets" };

type AssetTicket = {
  id: string;
  number: number;
  subject: string;
  status: string;
  created_at: string;
  asset: { asset_tag: string; name: string } | null;
};

export default async function MyAssetsPage() {
  const me = await requireViewer();
  const supabase = await createClient();

  const [assetsRes, ticketsRes, teamRes] = await Promise.all([
    supabase
      .from("assets")
      .select("id, asset_tag, name, type, manufacturer, model, serial_number, status, warranty_until")
      .eq("assigned_to", me.id)
      .order("type")
      .order("name"),
    supabase
      .from("tickets")
      .select("id, number, subject, status, created_at, asset:assets(asset_tag, name)")
      .eq("requester_id", me.id)
      .not("asset_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(10),
    // The team that looks after devices (IT by default).
    supabase.from("teams").select("key").eq("manages_assets", true).eq("active", true).order("sort_order").limit(1).maybeSingle(),
  ]);
  if (assetsRes.error) throw new Error("We couldn't load your devices. Please try again.");

  const assets = (assetsRes.data ?? []) as MyAsset[];
  const tickets = (ticketsRes.data ?? []) as unknown as AssetTicket[];
  const teamKey = teamRes.data?.key ?? "it";
  const today = orgToday();
  const reportHref = (id: string) => `/requests/new?team=${encodeURIComponent(teamKey)}&asset=${id}`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="My assets"
        description="Devices and licences the company has given you. Something not working? Report it from here."
        breadcrumbs={[{ label: "Home", href: "/home" }, { label: "My assets" }]}
      />

      {assets.length === 0 ? (
        <Card>
          <EmptyState
            icon={Laptop}
            title="No devices assigned to you yet"
            description="If you were given a laptop or other equipment and it isn't listed here, let IT know so they can add it."
            action={
              <Link href={`/requests/new?team=${encodeURIComponent(teamKey)}`} className={buttonClass("outline")}>
                <MessageSquarePlus className="h-4 w-4" /> Tell IT
              </Link>
            }
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {assets.map((a) => (
            <li key={a.id}>
              <AssetCard asset={a} warranty={warrantyState(a.warranty_until, today)} reportHref={reportHref(a.id)} />
            </li>
          ))}
        </ul>
      )}

      {tickets.length > 0 && (
        <Card className="mt-8">
          <CardHeader title="Recent problems with your devices" description="Requests you raised that are linked to a device." />
          <ul className="divide-y divide-slate-100">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/requests/${t.number}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{t.subject}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      <span className="font-mono">{ticketRef(t.number)}</span>
                      {t.asset && (
                        <>
                          {" · "}
                          {t.asset.name} <span className="font-mono">({t.asset.asset_tag})</span>
                        </>
                      )}
                      {" · "}
                      {formatDate(t.created_at)}
                    </p>
                  </div>
                  <TicketStatusBadge status={t.status} audience="requester" />
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
