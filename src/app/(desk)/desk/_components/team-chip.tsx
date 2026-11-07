import { cn } from "@/lib/utils";

/** Small team label tinted with the team colour. */
export function TeamChip({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", className)}
      style={{ color, backgroundColor: `${color}12`, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}
