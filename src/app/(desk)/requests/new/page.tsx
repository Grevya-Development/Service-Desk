import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { NewRequestForm } from "../_components/new-request-form";
import { UUID_RE, param } from "../_lib/query";
import { IncidentBanner } from "../../_components/incident-banner";

export const metadata: Metadata = { title: "Report an issue" };

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireViewer();
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: teams }, { data: categories }, { data: assets }] = await Promise.all([
    supabase.from("teams").select("id, key, name, description, color, icon, manages_assets").eq("active", true).order("sort_order").order("name"),
    supabase.from("categories").select("id, team_id, name, description").eq("active", true).order("sort_order").order("name"),
    supabase.from("assets").select("id, asset_tag, name, type").eq("assigned_to", me.id).order("asset_tag"),
  ]);

  const teamList = teams ?? [];
  const teamKey = param(sp.team).toLowerCase();
  const assetParam = param(sp.asset);
  const preTeam = teamList.find((t) => t.key === teamKey) ?? (teamList.length === 1 ? teamList[0] : null);
  const assetList = assets ?? [];
  const preAsset = UUID_RE.test(assetParam) && assetList.some((a) => a.id === assetParam) ? assetParam : null;
  // A device link usually means a tech problem: default to the team that manages assets.
  const initialTeam = preTeam ?? (preAsset ? (teamList.find((t) => t.manages_assets) ?? null) : null);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Report an issue"
        description="Tell us what's wrong and the right team will pick it up."
        breadcrumbs={[{ label: "Home", href: "/home" }, { label: "Report an issue" }]}
      />
      <Suspense fallback={null}>
        <IncidentBanner className="mb-6" />
      </Suspense>
      {teamList.length === 0 ? (
        <Card>
          <EmptyState
            icon={LifeBuoy}
            title="No teams are taking requests right now"
            description="Please check back later, or ask your manager who to contact."
            action={
              <Link href="/home" className={buttonClass("outline")}>
                Back to home
              </Link>
            }
          />
        </Card>
      ) : (
        <NewRequestForm
          teams={teamList.map((t) => ({ id: t.id, key: t.key, name: t.name, description: t.description, color: t.color, icon: t.icon }))}
          categories={(categories ?? []).map((c) => ({ id: c.id, teamId: c.team_id, name: c.name, description: c.description }))}
          assets={assetList}
          initialTeamId={initialTeam?.id ?? null}
          initialAssetId={preAsset}
        />
      )}
      <p className="mt-6 text-center text-xs text-slate-500">
        Need something new, like software or access?{" "}
        <Link href="/catalog" className="font-medium text-primary-600 hover:underline">
          Request a service
        </Link>{" "}
        instead.
      </p>
    </div>
  );
}
