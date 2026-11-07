import { cn } from "@/lib/utils";

/** Small team label with the team's colour as a dot. */
export function TeamChip({ team, className }: { team: { name: string; color: string } | null | undefined; className?: string }) {
  if (!team) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700", className)}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: team.color }} aria-hidden />
      {team.name}
    </span>
  );
}
