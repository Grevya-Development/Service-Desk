export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-56 rounded-md bg-slate-200/70" />
      <div className="h-4 w-80 rounded bg-slate-200/50" />
      <div className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-36 rounded-xl bg-white shadow-sm" />
        ))}
      </div>
      <div className="h-72 rounded-xl bg-white shadow-sm" />
    </div>
  );
}
