export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse" aria-busy="true" aria-label="Loading service status">
      <div className="h-7 w-48 rounded-md bg-slate-200/70" />
      <div className="mt-2 h-4 w-80 max-w-full rounded bg-slate-200/50" />
      <div className="mt-6 h-20 rounded-xl bg-white shadow-sm" />
      <div className="mt-5 h-72 rounded-xl bg-white shadow-sm" />
      <div className="mt-8 h-4 w-56 rounded bg-slate-200/60" />
      <div className="mt-3 h-24 rounded-xl bg-white shadow-sm" />
    </div>
  );
}
