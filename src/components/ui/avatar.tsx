import { cn, initials } from "@/lib/utils";

const palette = ["bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-lime-600", "bg-emerald-600", "bg-teal-600", "bg-sky-600", "bg-indigo-600", "bg-violet-600", "bg-fuchsia-600"];

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

const sizes = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-lg", xl: "h-20 w-20 text-2xl" };

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const n = name ?? "?";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={n} className={cn("shrink-0 rounded-full object-cover ring-2 ring-white", sizes[size], className)} />;
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white", colorFor(n), sizes[size], className)}>
      {initials(n)}
    </span>
  );
}
