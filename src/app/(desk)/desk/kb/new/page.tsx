import type { Metadata } from "next";
import { Users } from "lucide-react";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ArticleEditor } from "../_components/article-editor";

export const metadata: Metadata = { title: "New article" };

export default async function NewArticlePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAgent();
  const sp = await searchParams;
  const requestedTeam = typeof sp.team === "string" ? sp.team : null;

  const supabase = await createClient();
  const [{ data: teams }, { data: categories }] = await Promise.all([
    supabase.from("teams").select("id, name, color").in("id", me.agentTeamIds).eq("active", true).order("sort_order"),
    supabase.from("categories").select("id, name, team_id").in("team_id", me.agentTeamIds).eq("active", true).order("sort_order"),
  ]);

  return (
    <div>
      <PageHeader
        title="New article"
        description="Write a help article for your team. Save it as a draft until it's ready."
        breadcrumbs={[{ label: "Manage articles", href: "/desk/kb" }, { label: "New article" }]}
      />
      {teams?.length ? (
        <ArticleEditor article={null} teams={teams} categories={categories ?? []} defaultTeamId={requestedTeam} />
      ) : (
        <Card>
          <EmptyState icon={Users} title="You're not in an active team" description="Ask a team lead to add you to a team before writing articles." />
        </Card>
      )}
    </div>
  );
}
