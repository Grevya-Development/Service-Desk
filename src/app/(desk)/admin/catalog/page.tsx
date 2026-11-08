import Link from "next/link";
import { Package, Pencil, Plus } from "lucide-react";
import { requireLead } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { APPROVAL_KINDS, type ApprovalKind } from "@/lib/constants";
import { Badge, Card, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR, buttonClass } from "@/components/ui";
import { ActionButton } from "@/components/ui/action-button";
import { NamedIcon } from "../_lib/icons";
import { loadLeadTeams } from "../_lib/data";
import { TeamChip } from "../_components/team-chip";
import { setCatalogActive } from "./actions";

export const metadata = { title: "Service catalog admin" };

const APPROVAL_TONE = { none: "gray", manager: "yellow", team_lead: "purple" } as const;

export default async function AdminCatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireLead();
  const sp = await searchParams;
  const supabase = await createClient();
  const teams = await loadLeadTeams(supabase, me);
  const filterTeam = typeof sp.team === "string" ? teams.find((t) => t.id === sp.team) : undefined;
  const teamIds = filterTeam ? [filterTeam.id] : teams.map((t) => t.id);

  const { data: items } = teamIds.length
    ? await supabase
        .from("catalog_items")
        .select("id, team_id, name, description, icon, approval, active, sort_order, fields, system_key, category:categories(name), requests:tickets(count)")
        .in("team_id", teamIds)
        .order("sort_order")
        .order("name")
    : { data: [] };
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const list = (items ?? []).slice().sort((a, b) => {
    const ta = teams.findIndex((t) => t.id === a.team_id);
    const tb = teams.findIndex((t) => t.id === b.team_id);
    return ta - tb || a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  });
  const newHref = filterTeam ? `/admin/catalog/new?team=${filterTeam.id}` : "/admin/catalog/new";

  return (
    <>
      <PageHeader
        title="Service catalog"
        description="Ready-made requests employees can pick, each with its own short form and optional approval step."
        breadcrumbs={[{ label: "Administration" }, { label: "Service catalog" }]}
        actions={
          teams.length > 0 && (
            <Link href={newHref} className={buttonClass()}>
              <Plus className="h-4 w-4" />
              New item
            </Link>
          )
        }
      />

      {teams.length > 1 && (
        <nav aria-label="Filter by team" className="mb-4 flex flex-wrap gap-2">
          <Link
            href="/admin/catalog"
            aria-current={!filterTeam ? "page" : undefined}
            className={buttonClass(!filterTeam ? "secondary" : "ghost", "sm", "rounded-full")}
          >
            All teams
          </Link>
          {teams.map((t) => (
            <Link
              key={t.id}
              href={`/admin/catalog?team=${t.id}`}
              aria-current={filterTeam?.id === t.id ? "page" : undefined}
              className={buttonClass(filterTeam?.id === t.id ? "secondary" : "ghost", "sm", "rounded-full")}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
              {t.name}
            </Link>
          ))}
        </nav>
      )}

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No catalog items yet"
            description="Add common requests, like “New laptop” or “Salary certificate”, so people don't have to explain them from scratch."
            action={
              teams.length > 0 && (
                <Link href={newHref} className={buttonClass("primary", "sm")}>
                  <Plus className="h-3.5 w-3.5" />
                  New item
                </Link>
              )
            }
          />
        ) : (
          <Table className="relative">
            <THead>
              <TR>
                <TH>Item</TH>
                <TH>Team</TH>
                <TH className="hidden md:table-cell">Category</TH>
                <TH>Approval</TH>
                <TH className="hidden text-right sm:table-cell">Fields</TH>
                <TH className="text-right">Requests</TH>
                <TH>Status</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((it) => {
                const team = teamById.get(it.team_id);
                const approval = (Object.hasOwn(APPROVAL_KINDS, it.approval) ? it.approval : "none") as ApprovalKind;
                const fieldCount = Array.isArray(it.fields) ? it.fields.length : 0;
                return (
                  <TR key={it.id} className={it.active ? undefined : "bg-slate-50/70"}>
                    <TD>
                      <Link href={`/admin/catalog/${it.id}`} className="group flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                          <NamedIcon name={it.icon} className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-slate-800 group-hover:text-primary-700">{it.name}</span>
                            {it.system_key && (
                              <span title="Opened automatically by People Success for new joiners">
                                <Badge tone="purple">People Success</Badge>
                              </span>
                            )}
                          </span>
                          {it.description && <span className="block max-w-xs truncate text-xs text-slate-500">{it.description}</span>}
                        </span>
                      </Link>
                    </TD>
                    <TD>{team && <TeamChip name={team.name} color={team.color} />}</TD>
                    <TD className="hidden md:table-cell">{it.category?.name ?? <span className="text-slate-400">—</span>}</TD>
                    <TD>
                      <Badge tone={APPROVAL_TONE[approval]}>{APPROVAL_KINDS[approval]}</Badge>
                    </TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">{fieldCount}</TD>
                    <TD className="text-right tabular-nums">{it.requests?.[0]?.count ?? 0}</TD>
                    <TD>{it.active ? <Badge tone="green">Live</Badge> : <Badge tone="gray">Hidden</Badge>}</TD>
                    <TD>
                      <div className="flex justify-end gap-1.5">
                        <Link href={`/admin/catalog/${it.id}`} className={buttonClass("ghost", "sm")} aria-label={`Edit ${it.name}`}>
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Edit</span>
                        </Link>
                        <ActionButton
                          action={setCatalogActive}
                          fields={{ id: it.id, active: !it.active }}
                          variant="outline"
                          confirm={it.system_key && it.active ? "Hide it? People Success will stop opening IT setup requests for new joiners." : undefined}
                        >
                          {it.active ? "Hide" : "Show"}
                        </ActionButton>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
