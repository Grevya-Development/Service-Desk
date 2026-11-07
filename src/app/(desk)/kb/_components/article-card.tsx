import Link from "next/link";
import { Eye, Lock } from "lucide-react";
import { excerpt } from "@/components/markdown";
import { formatDate, formatNumber } from "@/lib/utils";
import { TeamChip } from "./team-chip";

export type CardArticle = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  team_id: string;
  category_id: string | null;
  visibility: string;
  view_count: number;
  updated_at: string;
};

export type CardTeam = { id: string; key: string; name: string; color: string };

/** Columns needed by <ArticleCard>. */
export const CARD_COLUMNS = "id, slug, title, summary, body, team_id, category_id, visibility, view_count, updated_at";

export function ArticleCard({
  article,
  team,
  categoryName,
  showViews = false,
}: {
  article: CardArticle;
  team?: CardTeam;
  categoryName?: string | null;
  showViews?: boolean;
}) {
  const blurb = article.summary?.trim() || excerpt(article.body, 150);
  return (
    <Link
      href={`/kb/${article.slug}`}
      className="group flex h-full flex-col rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition hover:-translate-y-px hover:border-primary-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {team && <TeamChip name={team.name} color={team.color} />}
        {categoryName && <span className="text-xs text-slate-500">{categoryName}</span>}
        {article.visibility === "agents" && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Lock className="h-3 w-3" aria-hidden /> Agents only
          </span>
        )}
      </div>
      <h3 className="mt-2.5 text-[15px] font-semibold leading-snug text-slate-900 group-hover:text-primary-700">{article.title}</h3>
      {blurb && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-500">{blurb}</p>}
      <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-slate-400">
        <span>Updated {formatDate(article.updated_at)}</span>
        {showViews && (
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3 w-3" aria-hidden /> {formatNumber(article.view_count)}
          </span>
        )}
      </div>
    </Link>
  );
}
