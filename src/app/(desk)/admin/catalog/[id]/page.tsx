import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { requireLead } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPriority, type ApprovalKind } from "@/lib/constants";
import { Badge, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/ui/action-button";
import { isUuid, parseStoredFields } from "../../_lib/validate";
import { deleteCatalogItem, setCatalogActive } from "../actions";
import { CatalogEditor } from "../_components/catalog-editor";
import { loadEditorData } from "../_lib/editor-data";

export const metadata = { title: "Edit catalog item" };

export default async function EditCatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireLead();
  if (!isUuid(id)) notFound();
  const supabase = await createClient();

  const [{ data: item }, editor, { count: requests }] = await Promise.all([
    supabase
      .from("catalog_items")
      .select("id, team_id, category_id, name, description, icon, approval, default_priority, expected_days, active, sort_order, fields")
      .eq("id", id)
      .maybeSingle(),
    loadEditorData(supabase, me),
    supabase.from("tickets").select("id", { count: "exact", head: true }).eq("catalog_item_id", id),
  ]);
  if (!item || !me.leadTeamIds.includes(item.team_id)) notFound();

  const approval = (["none", "manager", "team_lead"].includes(item.approval) ? item.approval : "none") as ApprovalKind;
  const used = (requests ?? 0) > 0;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {item.name}
            {!item.active && <Badge tone="gray">Hidden</Badge>}
          </span>
        }
        description={used ? `${requests} request${requests === 1 ? "" : "s"} so far.` : "No requests yet."}
        breadcrumbs={[{ label: "Administration" }, { label: "Service catalog", href: "/admin/catalog" }, { label: item.name }]}
        actions={
          <>
            <ActionButton action={setCatalogActive} fields={{ id: item.id, active: !item.active }} variant="outline" size="md">
              {item.active ? "Hide from catalog" : "Show in catalog"}
            </ActionButton>
            <ActionButton
              action={deleteCatalogItem}
              fields={{ id: item.id }}
              variant="danger"
              size="md"
              className="bg-white text-red-600 shadow-none ring-1 ring-red-200 hover:bg-red-50"
              confirm={
                used
                  ? `“${item.name}” has requests, so it will be hidden from the catalog instead of deleted. Continue?`
                  : `Delete “${item.name}”? This can't be undone.`
              }
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </ActionButton>
          </>
        }
      />
      <CatalogEditor
        key={`${item.id}-${item.active}`}
        teams={editor.teams}
        categories={editor.categories}
        item={{
          id: item.id,
          team_id: item.team_id,
          category_id: item.category_id,
          name: item.name,
          description: item.description,
          icon: item.icon,
          approval,
          default_priority: isPriority(item.default_priority) ? item.default_priority : "medium",
          expected_days: item.expected_days,
          active: item.active,
          sort_order: item.sort_order,
          fields: parseStoredFields(item.fields),
        }}
      />
    </>
  );
}
