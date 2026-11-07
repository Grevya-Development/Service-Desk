import { ArrowDown, ArrowUp, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { requireLead } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ActionButton } from "@/components/ui/action-button";
import { Dialog } from "@/components/ui/dialog";
import { pickTeam } from "../_lib/access";
import { loadLeadTeams } from "../_lib/data";
import { TeamSwitcher } from "../_components/team-switcher";
import { CategoryForm } from "./_components/category-form";
import { deleteCategory, moveCategory, setCategoryActive } from "./actions";

export const metadata = { title: "Categories" };

const countOf = (rel: { count: number }[] | null | undefined) => rel?.[0]?.count ?? 0;

export default async function AdminCategoriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireLead();
  const sp = await searchParams;
  const supabase = await createClient();
  const teams = await loadLeadTeams(supabase, me);
  const team = pickTeam(teams, sp.team);

  const header = (
    <PageHeader
      title="Categories"
      description="Categories sort tickets, help articles and catalog items so the right people find them. Requesters pick one when they report an issue."
      breadcrumbs={[{ label: "Administration" }, { label: "Categories" }]}
      actions={
        team && (
          <Dialog
            title={`New category for ${team.name}`}
            trigger={
              <Button>
                <Plus className="h-4 w-4" />
                Add category
              </Button>
            }
          >
            <CategoryForm teamId={team.id} />
          </Dialog>
        )
      }
    />
  );

  if (!team) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={FolderTree} title="No teams to manage" description="You'll see categories here once you lead a team." />
        </Card>
      </>
    );
  }

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, description, active, sort_order, tickets(count), kb_articles(count), catalog_items(count)")
    .eq("team_id", team.id)
    .order("sort_order")
    .order("name");
  const list = categories ?? [];

  return (
    <>
      {header}
      <TeamSwitcher teams={teams} selectedId={team.id} basePath="/admin/categories" />

      <Card className="overflow-hidden">
        <div className="h-1" style={{ backgroundColor: team.color }} />
        <CardHeader
          title={`${team.name} categories`}
          description="Use the arrows to set the order people see. Deactivate a category to stop it being picked on new tickets; past tickets keep it."
        />
        {list.length === 0 ? (
          <EmptyState icon={FolderTree} title="No categories yet" description="Add a few categories, plus an “Other” for everything else." />
        ) : (
          <Table className="relative">
            <THead>
              <TR>
                <TH className="w-24">Order</TH>
                <TH>Category</TH>
                <TH className="text-right">Tickets</TH>
                <TH>Status</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {list.map((c, i) => {
                const tickets = countOf(c.tickets);
                const inUse = tickets + countOf(c.kb_articles) + countOf(c.catalog_items) > 0;
                return (
                  <TR key={c.id} className={c.active ? undefined : "bg-slate-50/70"}>
                    <TD>
                      <div className="flex items-center gap-1">
                        <ActionButton action={moveCategory} fields={{ id: c.id, dir: "up" }} variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} title={`Move ${c.name} up`}>
                          <ArrowUp className="h-3.5 w-3.5" />
                          <span className="sr-only">Move up</span>
                        </ActionButton>
                        <ActionButton
                          action={moveCategory}
                          fields={{ id: c.id, dir: "down" }}
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={i === list.length - 1}
                          title={`Move ${c.name} down`}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                          <span className="sr-only">Move down</span>
                        </ActionButton>
                      </div>
                    </TD>
                    <TD>
                      <p className={c.active ? "font-medium text-slate-800" : "font-medium text-slate-500"}>{c.name}</p>
                      {c.description && <p className="mt-0.5 max-w-md text-xs text-slate-500">{c.description}</p>}
                    </TD>
                    <TD className="text-right tabular-nums">{tickets}</TD>
                    <TD>{c.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</TD>
                    <TD>
                      <div className="flex justify-end gap-1.5">
                        <Dialog
                          title={`Edit “${c.name}”`}
                          trigger={
                            <Button variant="ghost" size="sm" aria-label={`Edit ${c.name}`}>
                              <Pencil className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Edit</span>
                            </Button>
                          }
                        >
                          <CategoryForm category={c} />
                        </Dialog>
                        <ActionButton action={setCategoryActive} fields={{ id: c.id, active: !c.active }} variant="outline">
                          {c.active ? "Deactivate" : "Activate"}
                        </ActionButton>
                        {!inUse && (
                          <ActionButton
                            action={deleteCategory}
                            fields={{ id: c.id }}
                            variant="danger"
                            className="bg-white text-red-600 shadow-none ring-1 ring-red-200 hover:bg-red-50"
                            confirm={`Delete “${c.name}”? This can't be undone.`}
                            title={`Delete ${c.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </ActionButton>
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Categories that are used by tickets, help articles or catalog items can&apos;t be deleted, only deactivated. Keep an “Other” category: imported HR Helpdesk
        tickets fall back to it.
      </p>
    </>
  );
}
