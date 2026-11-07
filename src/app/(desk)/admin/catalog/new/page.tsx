import { Package } from "lucide-react";
import { requireLead } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { CatalogEditor } from "../_components/catalog-editor";
import { loadEditorData } from "../_lib/editor-data";

export const metadata = { title: "New catalog item" };

export default async function NewCatalogItemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireLead();
  const sp = await searchParams;
  const supabase = await createClient();
  const { teams, categories } = await loadEditorData(supabase, me);
  const defaultTeamId = typeof sp.team === "string" && teams.some((t) => t.id === sp.team) ? sp.team : undefined;

  return (
    <>
      <PageHeader
        title="New catalog item"
        description="A service employees can request with one click, like a new laptop or an experience letter."
        breadcrumbs={[{ label: "Administration" }, { label: "Service catalog", href: "/admin/catalog" }, { label: "New item" }]}
      />
      {teams.length ? (
        <CatalogEditor teams={teams} categories={categories} defaultTeamId={defaultTeamId} />
      ) : (
        <Card>
          <EmptyState icon={Package} title="No teams to manage" description="You can add catalog items once you lead a team." />
        </Card>
      )}
    </>
  );
}
