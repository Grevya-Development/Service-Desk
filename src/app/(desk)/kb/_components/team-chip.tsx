import Link from "next/link";
import { cn } from "@/lib/utils";
import { safeColor } from "../_lib/article";

/** Small coloured pill for a team (IT blue, HR orange, …). Optional link and count. */
export function TeamChip({
  name,
  color,
  href,
  count,
  active,
  size = "sm",
  className,
}: {
  name: string;
  color: string | null | undefined;
  href?: string;
  count?: number;
  active?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const c = safeColor(color);
  const classes = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset transition-colors",
    size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-xs",
    href && !active && "hover:brightness-95",
    className,
  );
  const style = active
    ? { backgroundColor: c, color: "#fff", ["--tw-ring-color" as string]: c }
    : { backgroundColor: `${c}14`, color: c, ["--tw-ring-color" as string]: `${c}33` };
  const content = (
    <>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: active ? "#fff" : c }} />
      {name}
      {typeof count === "number" && <span className={cn("text-[0.85em] font-semibold", active ? "text-white/80" : "opacity-70")}>{count}</span>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes} style={style} aria-current={active ? "page" : undefined}>
        {content}
      </Link>
    );
  }
  return (
    <span className={classes} style={style}>
      {content}
    </span>
  );
}
