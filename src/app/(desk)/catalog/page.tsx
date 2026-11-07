import Link from "next/link";
import { MessageSquarePlus, ShoppingBag } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { CatalogBrowser, type CatalogTeam } from "./_components/catalog-browser";
import type { CatalogCardItem } from "./_components/catalog-card";

export const metadata = { title: "Service catalog" };

type Row = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  approval: string;
  expected_days: number | null;
  sort_order: number;
  team: { id: string; key: string; name: string; color: string; description: string | null; sort_order: number; active: boolean } | null;
  category: { id: string; name: string; sort_order: number; active: boolean } | null;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; team?: string | string[] }> }) {
  await requireViewer();
  const sp = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("catalog_items")
    .select(
      "id, name, description, icon, approval, expected_days, sort_order, team:teams(id, key, name, color, description, sort_order, active), category:categories(id, name, sort_order, active)",
    )
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw new Error("We couldn't load the service catalog. Please try again.");

  // Only items whose team is taking requests; ordered team → category → item.
  const rows = ((data ?? []) as unknown as Row[])
    .filter((r) => r.team?.active)
    .sort(
      (a, b) =>
        a.team!.sort_order - b.team!.sort_order ||
        a.team!.name.localeCompare(b.team!.name) ||
        (a.category?.sort_order ?? 999) - (b.category?.sort_order ?? 999) ||
        (a.category?.name ?? "").localeCompare(b.category?.name ?? "") ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name),
    );

  const teams = new Map<string, CatalogTeam>();
  const items: CatalogCardItem[] = rows.map((r) => {
    const t = r.team!;
    if (!teams.has(t.id)) teams.set(t.id, { id: t.id, key: t.key, name: t.name, color: t.color, description: t.description });
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      icon: r.icon,
      approval: r.approval,
      expectedDays: r.expected_days,
      teamId: t.id,
      teamKey: t.key,
      teamName: t.name,
      teamColor: t.color,
      categoryName: r.category?.name ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Request a service"
        description="Pick what you need and fill in a short form. We'll let you know as it moves along."
        breadcrumbs={[{ label: "Home", href: "/home" }, { label: "Request a service" }]}
        actions={
          <Link href="/requests/new" className={buttonClass("outline")}>
            <MessageSquarePlus className="h-4 w-4" /> Report an issue instead
          </Link>
        }
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={ShoppingBag}
            title="No services to request yet"
            description="Our teams haven't added any services here so far. You can still tell us what you need and we'll route it to the right people."
            action={
              <Link href="/requests/new" className={buttonClass("primary")}>
                <MessageSquarePlus className="h-4 w-4" /> Describe what you need
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <CatalogBrowser teams={[...teams.values()]} items={items} initialQuery={first(sp.q).slice(0, 100)} initialTeam={first(sp.team)} />
          <p className="mt-10 text-center text-xs text-slate-500">
            Can&apos;t find what you need?{" "}
            <Link href="/requests/new" className="font-medium text-primary-600 hover:text-primary-700">
              Tell us in your own words
            </Link>{" "}
            and we&apos;ll take it from there.
          </p>
        </>
      )}
    </div>
  );
}
