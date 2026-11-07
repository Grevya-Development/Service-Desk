import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  ClipboardList,
  Eye,
  Inbox,
  MessageSquareReply,
  Search,
  ShieldAlert,
  ShoppingBag,
  UserCheck,
  Wrench,
} from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, EmptyState, buttonClass } from "@/components/ui";
import { ApprovalBadge, TicketStatusBadge } from "@/components/tickets/badges";
import { OPEN_STATUSES, ticketRef } from "@/lib/constants";
import { formatDateTime, formatNumber, greeting } from "@/lib/utils";
import { TeamChip } from "../requests/_components/team-chip";
import { param, requestNow, timeAgo } from "../requests/_lib/query";
import { IncidentBanner } from "../_components/incident-banner";

export const metadata: Metadata = { title: "Home" };

type OpenTicket = {
  id: string;
  number: number;
  subject: string;
  status: string;
  approval_status: string;
  updated_at: string;
  team: { name: string; color: string } | null;
};

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireViewer();
  const sp = await searchParams;
  const denied = param(sp.denied) === "1";
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };

  const [open, waiting, articles, unassigned, mine] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, number, subject, status, approval_status, updated_at, team:teams(name, color)", { count: "exact" })
      .eq("requester_id", me.id)
      .in("status", OPEN_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase.from("tickets").select("number, subject", { count: "exact" }).eq("requester_id", me.id).eq("status", "pending").order("updated_at", { ascending: false }).limit(3),
    supabase.from("kb_articles").select("id, slug, title, summary, view_count").eq("status", "published").order("view_count", { ascending: false }).order("published_at", { ascending: false }).limit(5),
    me.isAgent && me.agentTeamIds.length
      ? supabase.from("tickets").select("id", head).in("team_id", me.agentTeamIds).is("assignee_id", null).in("status", ["new", "open"]).neq("approval_status", "pending")
      : Promise.resolve({ count: 0 }),
    me.isAgent ? supabase.from("tickets").select("id", head).eq("assignee_id", me.id).in("status", OPEN_STATUSES) : Promise.resolve({ count: 0 }),
  ]);

  const openTickets = (open.data ?? []) as unknown as OpenTicket[];
  const openCount = open.count ?? openTickets.length;
  const waitingOn = waiting.data ?? [];
  const waitingCount = waiting.count ?? waitingOn.length;
  const popular = articles.data ?? [];
  const now = requestNow();

  return (
    <div className="space-y-6">
      {denied && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          That page is only for support agents or team leads, so we brought you here instead.
        </div>
      )}

      <Suspense fallback={null}>
        <IncidentBanner />
      </Suspense>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 via-navy-800 to-primary-600 px-5 py-8 text-white shadow-sm sm:px-10 sm:py-10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-white/5" aria-hidden />
        <div className="relative max-w-2xl">
          <p className="text-sm font-medium text-white/70">
            {greeting()}, {me.firstName}
          </p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">How can we help today?</h1>
          <form action="/search" method="get" role="search" className="mt-5">
            <label htmlFor="home-search" className="sr-only">
              Search help articles and your requests
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  id="home-search"
                  name="q"
                  type="search"
                  required
                  placeholder="Search for answers, e.g. “reset password” or “payslip”"
                  className="h-12 w-full rounded-xl border-0 bg-white pl-12 pr-4 text-[15px] text-slate-800 shadow-lg placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-white/30"
                />
              </div>
              <button type="submit" className="h-12 rounded-xl bg-brand-yellow px-6 text-sm font-semibold text-navy-950 shadow-lg transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40">
                Search
              </button>
            </div>
          </form>
          <p className="mt-3 text-xs text-white/60">Tip: type a request number like SD-1042 to jump straight to it.</p>
        </div>
      </section>

      {/* Primary actions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ActionTile
          href="/requests/new"
          icon={Wrench}
          accent="bg-red-50 text-red-600"
          title="Report an issue"
          text="Something broken or not working? Tell us and we'll fix it."
        />
        <ActionTile href="/catalog" icon={ShoppingBag} accent="bg-primary-50 text-primary-600" title="Request a service" text="Need something new: software, access, equipment or an HR letter?" />
      </div>

      {/* Waiting on you */}
      {waitingOn.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4" aria-labelledby="waiting-title">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <MessageSquareReply className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="waiting-title" className="text-sm font-semibold text-amber-900">
                {waitingCount === 1 ? "A request is waiting on you" : `${waitingCount} requests are waiting on you`}
              </h2>
              <p className="mt-0.5 text-sm text-amber-800">The team needs your reply before they can carry on.</p>

              <ul className="mt-2 space-y-1">
                {waitingOn.map((t) => (
                  <li key={t.number}>
                    <Link href={`/requests/${t.number}#reply`} className="group inline-flex max-w-full items-center gap-2 text-sm font-medium text-amber-900 hover:underline">
                      <span className="font-mono text-xs text-amber-700">{ticketRef(t.number)}</span>
                      <span className="truncate">{t.subject}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 transition group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              {waitingCount > waitingOn.length && (
                <Link href="/requests?tab=open" className="mt-2 inline-block text-xs font-medium text-amber-900 underline">
                  See all {waitingCount}
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Your open requests */}
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title="Your open requests"
            description={openCount ? `${openCount} open` : undefined}
            action={
              <Link href="/requests" className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline">
                View all <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            }
          />
          {openTickets.length ? (
            <ul className="divide-y divide-slate-100">
              {openTickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/requests/${t.number}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{t.subject}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span className="font-mono">{ticketRef(t.number)}</span>
                        <TeamChip team={t.team} />
                        <span title={formatDateTime(t.updated_at)}>Updated {timeAgo(t.updated_at, now)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <TicketStatusBadge status={t.status} audience="requester" />
                      <ApprovalBadge status={t.approval_status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="No open requests"
              description="When you report an issue or request a service, you can follow its progress here."
              action={
                <Link href="/requests" className={buttonClass("outline", "sm")}>
                  See past requests
                </Link>
              }
            />
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          {/* Agent shortcut */}
          {me.isAgent && (
            <Card className="overflow-hidden">
              <div className="bg-navy-900 px-5 py-3.5 text-white">
                <p className="text-sm font-semibold">Agent workspace</p>
                <p className="text-xs text-white/70">{me.memberships.length ? me.memberships.map((m) => m.teamName).join(" · ") : "All teams"}</p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-100">
                <Link href="/desk" className="px-5 py-4 hover:bg-slate-50">
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Inbox className="h-3.5 w-3.5" aria-hidden /> Unassigned
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(unassigned.count ?? 0)}</p>
                </Link>
                <Link href="/desk?view=mine" className="px-5 py-4 hover:bg-slate-50">
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <UserCheck className="h-3.5 w-3.5" aria-hidden /> Assigned to me
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{formatNumber(mine.count ?? 0)}</p>
                </Link>
              </div>
              <Link href="/desk" className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5 text-xs font-medium text-primary-600 hover:bg-slate-50">
                Open the ticket queue <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Card>
          )}

          {/* Popular articles */}
          <Card>
            <CardHeader
              title="Popular help articles"
              action={
                <Link href="/kb" className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline">
                  Browse all <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              }
            />
            {popular.length ? (
              <ul className="divide-y divide-slate-100">
                {popular.map((a) => (
                  <li key={a.id}>
                    <Link href={`/kb/${a.slug}`} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{a.title}</p>
                        {a.summary && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{a.summary}</p>}
                      </div>
                      {a.view_count > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-slate-400" title={`${a.view_count} views`}>
                          <Eye className="h-3 w-3" aria-hidden /> {formatNumber(a.view_count)}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={BookOpen} title="No articles yet" description="Help articles from IT and HR will appear here as they're published." className="py-8" />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ActionTile({ href, icon: Icon, accent, title, text }: { href: string; icon: typeof Wrench; accent: string; title: string; text: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-sm text-slate-500">{text}</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary-600" aria-hidden />
    </Link>
  );
}
