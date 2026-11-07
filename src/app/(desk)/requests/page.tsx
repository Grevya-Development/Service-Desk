import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, Plus, Search, SearchX, Users } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { LinkTabs } from "@/components/ui/link-tabs";
import { OPEN_STATUSES } from "@/lib/constants";
import { RequestList, type RequestListItem } from "./_components/request-list";
import { Pager } from "./_components/pager";
import { pageParam, param, parseTicketNumber, requestNow, sanitizeSearch } from "./_lib/query";

export const metadata: Metadata = { title: "My requests" };

const PAGE_SIZE = 25;

const TABS = {
  open: { label: "Open", statuses: OPEN_STATUSES as string[] },
  resolved: { label: "Resolved", statuses: ["resolved"] },
  closed: { label: "Closed", statuses: ["closed"] },
  all: { label: "All", statuses: null },
  following: { label: "Following", statuses: null },
} as const;
type TabKey = keyof typeof TABS;
const isTab = (v: string): v is TabKey => v in TABS;

export default async function MyRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireViewer();
  const sp = await searchParams;
  const rawQ = param(sp.q).trim().slice(0, 100);
  const tabParam = param(sp.tab);

  // Tabs are URL-driven; always carry `tab` first so the active tab highlights correctly.
  if (!isTab(tabParam)) redirect(`/requests?tab=open${rawQ ? `&q=${encodeURIComponent(rawQ)}` : ""}`);
  const tab: TabKey = tabParam;
  const page = pageParam(sp.page);

  const number = parseTicketNumber(rawQ);
  const safe = sanitizeSearch(rawQ);
  const supabase = await createClient();

  const SELECT = "id, number, subject, status, priority, approval_status, updated_at, team:teams(name, color), assignee:people!assignee_id(full_name)";
  // "Following": requests other people raised and added me to (ticket_followers).
  const FOLLOW_SELECT = `${SELECT}, requester:people!requester_id(full_name), ticket_followers!inner(employee_id)`;
  const filtered = (statuses: readonly string[] | null, head = false, following = false) => {
    let q = following
      ? supabase.from("tickets").select(head ? "id, ticket_followers!inner(employee_id)" : FOLLOW_SELECT, { count: "exact", head }).eq("ticket_followers.employee_id", me.id)
      : supabase.from("tickets").select(head ? "id" : SELECT, { count: "exact", head }).eq("requester_id", me.id);
    if (statuses) q = q.in("status", statuses as string[]);
    if (number && safe) q = q.or(`number.eq.${number},subject.ilike.%${safe}%`);
    else if (safe) q = q.ilike("subject", `%${safe}%`);
    return q;
  };

  const from = (page - 1) * PAGE_SIZE;
  const [list, openCount, resolvedCount, closedCount, followingCount] = await Promise.all([
    filtered(TABS[tab].statuses, false, tab === "following").order("updated_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    filtered(TABS.open.statuses, true),
    filtered(TABS.resolved.statuses, true),
    filtered(TABS.closed.statuses, true),
    filtered(null, true, true),
  ]);

  const items = (list.data ?? []) as unknown as RequestListItem[];
  const total = list.count ?? 0;
  const counts: Record<TabKey, number> = {
    open: openCount.count ?? 0,
    resolved: resolvedCount.count ?? 0,
    closed: closedCount.count ?? 0,
    all: (openCount.count ?? 0) + (resolvedCount.count ?? 0) + (closedCount.count ?? 0),
    following: followingCount.count ?? 0,
  };

  const qPart = rawQ ? `&q=${encodeURIComponent(rawQ)}` : "";
  // Only show "Following" to people who follow something (or who just landed on it).
  const tabs = (Object.keys(TABS) as TabKey[])
    .filter((k) => k !== "following" || counts.following > 0 || tab === "following")
    .map((k) => ({ label: TABS[k].label, href: `/requests?tab=${k}${qPart}`, count: counts[k] }));
  const now = requestNow();

  return (
    <div>
      <PageHeader
        title="My requests"
        description="Everything you've asked IT, HR and other teams for help with."
        breadcrumbs={[{ label: "Home", href: "/home" }, { label: "My requests" }]}
        actions={
          <>
            <Link href="/catalog" className={buttonClass("outline")}>
              Request a service
            </Link>
            <Link href="/requests/new" className={buttonClass("primary")}>
              <Plus className="h-4 w-4" /> Report an issue
            </Link>
          </>
        }
      />

      <LinkTabs tabs={tabs} />

      <Card>
        <form action="/requests" method="get" role="search" className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center">
          <input type="hidden" name="tab" value={tab} />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              name="q"
              defaultValue={rawQ}
              placeholder="Search by subject or number (e.g. SD-1042)"
              aria-label={tab === "following" ? "Search requests you follow" : "Search your requests"}
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("secondary")}>
              Search
            </button>
            {rawQ && (
              <Link href={`/requests?tab=${tab}`} className={buttonClass("ghost")}>
                Clear
              </Link>
            )}
          </div>
        </form>

        {items.length > 0 ? (
          <>
            <RequestList items={items} now={now} showRequester={tab === "following"} />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} noun="requests" hrefFor={(p) => `/requests?tab=${tab}${qPart}&page=${p}`} />
          </>
        ) : rawQ && tab !== "following" ? (
          <EmptyState
            icon={SearchX}
            title={`No requests match “${rawQ}”`}
            description={tab === "all" ? "Try different words or a request number like SD-1042." : "Try different words, or look in the All tab."}
            action={
              <Link href={`/requests?tab=${tab === "all" ? "open" : "all"}${qPart}`} className={buttonClass("outline", "sm")}>
                {tab === "all" ? "Back to open requests" : "Search all requests"}
              </Link>
            }
          />
        ) : page > 1 ? (
          <EmptyState
            title="Nothing on this page"
            action={
              <Link href={`/requests?tab=${tab}`} className={buttonClass("outline", "sm")}>
                Go to the first page
              </Link>
            }
          />
        ) : (
          <EmptyState icon={tab === "following" ? Users : ClipboardList} {...emptyCopy(tab, counts.all, rawQ)} />
        )}
      </Card>
    </div>
  );
}

function emptyCopy(tab: TabKey, all: number, q: string) {
  const raise = (
    <div className="flex flex-wrap justify-center gap-2">
      <Link href="/requests/new" className={buttonClass("primary", "sm")}>
        <Plus className="h-3.5 w-3.5" /> Report an issue
      </Link>
      <Link href="/catalog" className={buttonClass("outline", "sm")}>
        Request a service
      </Link>
    </div>
  );
  if (tab === "following") {
    return q
      ? { title: `No followed requests match “${q}”`, description: "Try different words or a request number." }
      : {
          title: "You're not following any requests",
          description: "When a colleague adds you to one of their requests, it shows up here so you can keep track and reply.",
        };
  }
  if (all === 0) {
    return { title: "You haven't raised any requests yet", description: "When something isn't working, or you need something new, start here. You can follow progress on this page.", action: raise };
  }
  switch (tab) {
    case "open":
      return { title: "No open requests", description: "Nice, nothing's waiting. Need help with something else?", action: raise };
    case "resolved":
      return { title: "No resolved requests", description: "Requests we've fixed show up here for a week, so you can confirm or reopen them." };
    case "closed":
      return { title: "No closed requests", description: "Finished requests end up here." };
    default:
      return { title: "No requests", action: raise };
  }
}
