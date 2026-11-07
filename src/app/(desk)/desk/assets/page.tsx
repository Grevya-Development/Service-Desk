import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, Download, PackageCheck, Plus, SearchX, ShieldAlert, UserCheck, Wrench } from "lucide-react";
import { requireAssetManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSET_STATUSES, ASSET_TYPES } from "@/lib/constants";
import { Avatar, Card, EmptyState, Input, PageHeader, Select, StatCard, Table, TBody, TD, TH, THead, TR, buttonClass } from "@/components/ui";
import { PAGE_SIZE, fetchAssetStats, fetchAssets, fetchLocations, filterQuery, hasFilters, parseAssetFilters } from "./_lib/data";
import { AssetStatusBadge, Pagination, WarrantyDate, assetTypeLabel } from "./_components/bits";

export const metadata = { title: "Assets" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAssetManager();
  const filters = parseAssetFilters(await searchParams);
  const supabase = await createClient();
  const from = (filters.page - 1) * PAGE_SIZE;

  const [stats, locations, list] = await Promise.all([
    fetchAssetStats(supabase),
    fetchLocations(supabase),
    fetchAssets(supabase, filters, { from, to: from + PAGE_SIZE - 1 }),
  ]);
  // Past the last page (e.g. after deleting filters' matches): go back to page 1.
  if (filters.page > 1 && (list.error || list.rows.length === 0)) redirect(`/desk/assets${filterQuery(filters, { page: 1 })}`);
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const filtered = hasFilters(filters);
  const exportHref = `/desk/assets/export${filterQuery({ ...filters, page: 1 })}`;

  return (
    <>
      <PageHeader
        title="Assets"
        description="Every laptop, phone and licence the company owns, and who has it."
        breadcrumbs={[{ label: "Agent workspace", href: "/desk" }, { label: "Assets" }]}
        actions={
          <>
            <a href={exportHref} className={buttonClass("outline")} download>
              <Download className="h-4 w-4" /> Export CSV
            </a>
            <Link href="/desk/assets/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" /> Add asset
            </Link>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total assets" value={stats.total} icon={Boxes} />
        <StatCard label="Assigned" value={stats.assigned} icon={UserCheck} tone="bg-blue-50 text-blue-600" />
        <StatCard label="In stock" value={stats.inStock} icon={PackageCheck} tone="bg-teal-50 text-teal-600" />
        <StatCard label="In repair" value={stats.inRepair} icon={Wrench} tone="bg-orange-50 text-orange-600" />
        <StatCard
          label="Warranty ending"
          value={stats.expiring}
          hint="In the next 30 days"
          icon={ShieldAlert}
          tone="bg-amber-50 text-amber-700"
          className="col-span-2 md:col-span-1"
        />
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.4fr)_auto]" role="search" aria-label="Filter assets">
          <div>
            <label htmlFor="f-q" className="sr-only">
              Search by tag, name, serial or model
            </label>
            <Input id="f-q" name="q" type="search" defaultValue={filters.q ?? ""} placeholder="Search tag, name, serial or model" />
          </div>
          <div>
            <label htmlFor="f-type" className="sr-only">
              Type
            </label>
            <Select id="f-type" name="type" defaultValue={filters.type ?? ""}>
              <option value="">All types</option>
              {Object.entries(ASSET_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="f-status" className="sr-only">
              Status
            </label>
            <Select id="f-status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">All statuses</option>
              {Object.entries(ASSET_STATUSES).map(([k, meta]) => (
                <option key={k} value={k}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="f-location" className="sr-only">
              Location
            </label>
            <Select id="f-location" name="location" defaultValue={filters.location ?? ""}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="none">No location</option>
            </Select>
          </div>
          <div>
            <label htmlFor="f-person" className="sr-only">
              Assigned to
            </label>
            <Input id="f-person" name="person" type="search" defaultValue={filters.person ?? ""} placeholder="Assigned to (name or email)" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("secondary", "md", "flex-1 2xl:flex-none")}>
              Apply
            </button>
            {filtered && (
              <Link href="/desk/assets" className={buttonClass("ghost", "md", "flex-1 2xl:flex-none")}>
                Clear
              </Link>
            )}
          </div>
        </form>

        {list.error ? (
          <EmptyState icon={SearchX} title="We couldn't load the asset register" description={list.error} />
        ) : list.rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No assets match these filters"
              description="Try a shorter search or clear the filters."
              action={
                <Link href="/desk/assets" className={buttonClass("outline", "sm")}>
                  Clear filters
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Boxes}
              title="No assets yet"
              description="Add the company's laptops, phones and other equipment to keep track of who has what."
              action={
                <Link href="/desk/assets/new" className={buttonClass("primary", "sm")}>
                  <Plus className="h-3.5 w-3.5" /> Add the first asset
                </Link>
              }
            />
          )
        ) : (
          <>
            <Table>
              <caption className="sr-only">Assets</caption>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH scope="col">Tag</TH>
                  <TH scope="col">Name</TH>
                  <TH scope="col">Type</TH>
                  <TH scope="col">Status</TH>
                  <TH scope="col">Assigned to</TH>
                  <TH scope="col">Location</TH>
                  <TH scope="col">Warranty until</TH>
                </TR>
              </THead>
              <TBody>
                {list.rows.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap">
                      <Link href={`/desk/assets/${a.id}`} className="font-mono text-xs font-semibold text-primary-700 hover:underline">
                        {a.asset_tag}
                      </Link>
                    </TD>
                    <TD className="min-w-48">
                      <Link href={`/desk/assets/${a.id}`} className="font-medium text-slate-800 hover:text-primary-700">
                        {a.name}
                      </Link>
                      {(a.manufacturer || a.model) && <p className="text-xs text-slate-500">{[a.manufacturer, a.model].filter(Boolean).join(" · ")}</p>}
                    </TD>
                    <TD className="whitespace-nowrap">{assetTypeLabel(a.type)}</TD>
                    <TD>
                      <AssetStatusBadge status={a.status} />
                    </TD>
                    <TD className="min-w-44">
                      {a.holder ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={a.holder.full_name} src={a.holder.avatar_url} size="xs" />
                          <span className="min-w-0">
                            <span className="block truncate text-slate-800">{a.holder.full_name}</span>
                            {a.holder.department && <span className="block truncate text-xs text-slate-500">{a.holder.department}</span>}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{a.location_id ? (locationName.get(a.location_id) ?? "—") : <span className="text-slate-400">—</span>}</TD>
                    <TD>
                      <WarrantyDate until={a.warranty_until} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={filters.page} pageSize={PAGE_SIZE} total={list.count} hrefFor={(page) => `/desk/assets${filterQuery(filters, { page })}`} />
          </>
        )}
      </Card>
    </>
  );
}
