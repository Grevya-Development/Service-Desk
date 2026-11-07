"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { PRIORITIES, PRIORITY_META, isPriority } from "@/lib/constants";
import { SORTS, queueHref, type QueueParams, type SortKey } from "../_lib/queue";

type Option = { id: string; name: string };

/** Filter bar for the queue. Builds the canonical URL so the view tabs stay highlighted. */
export function QueueFilters({ params, categories, agents }: { params: QueueParams; categories: Option[]; agents: Option[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const hasFilters = Boolean(params.priority || params.category || params.assignee || params.q || params.sort !== "sla");

  const apply = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const val = (k: string) => {
      const v = fd.get(k);
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const priority = val("priority");
    const sort = val("sort");
    const next: QueueParams = {
      ...params,
      priority: isPriority(priority) ? priority : null,
      category: val("category"),
      assignee: val("assignee"),
      q: val("q"),
      sort: sort && sort in SORTS ? (sort as SortKey) : "sla",
      page: 1,
    };
    startTransition(() => router.push(queueHref(next)));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    apply(e.currentTarget);
  };

  return (
    <form
      onSubmit={onSubmit}
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") apply(e.currentTarget);
      }}
      className="mb-4 flex flex-wrap items-end gap-2"
      role="search"
      aria-label="Filter tickets"
    >
      <div className="relative min-w-[12rem] flex-1">
        <label htmlFor="queue-q" className="sr-only">
          Search by subject or ticket number
        </label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input id="queue-q" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Search subject or SD-number…" className="pl-8" maxLength={100} />
      </div>
      <div>
        <label htmlFor="queue-priority" className="sr-only">
          Priority
        </label>
        <Select id="queue-priority" name="priority" defaultValue={params.priority ?? ""} className="w-auto min-w-[8.5rem]">
          <option value="">Any priority</option>
          {[...PRIORITIES].reverse().map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </Select>
      </div>
      {params.team && (
        <div>
          <label htmlFor="queue-category" className="sr-only">
            Category
          </label>
          <Select id="queue-category" name="category" defaultValue={params.category ?? ""} className="w-auto min-w-[9.5rem]">
            <option value="">Any category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div>
        <label htmlFor="queue-assignee" className="sr-only">
          Assignee
        </label>
        <Select id="queue-assignee" name="assignee" defaultValue={params.assignee ?? ""} className="w-auto min-w-[9.5rem]">
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor="queue-sort" className="sr-only">
          Sort by
        </label>
        <Select id="queue-sort" name="sort" defaultValue={params.sort} className="w-auto min-w-[9rem]">
          {Object.entries(SORTS).map(([k, label]) => (
            <option key={k} value={k}>
              Sort: {label}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        Search
      </Button>
      {hasFilters && (
        <Link
          href={queueHref({ ...params, priority: null, category: null, assignee: null, q: null, sort: "sla", page: 1 })}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </Link>
      )}
    </form>
  );
}
