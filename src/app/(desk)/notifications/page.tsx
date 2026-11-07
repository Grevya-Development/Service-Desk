import type { Metadata } from "next";
import { BellOff } from "lucide-react";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Pager } from "../requests/_components/pager";
import { pageParam } from "../requests/_lib/query";
import { MarkAllReadButton, NotificationList } from "./_components/notification-list";

export const metadata: Metadata = { title: "Notifications" };

const PAGE_SIZE = 30;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireViewer();
  const page = pageParam((await searchParams).page);
  const supabase = await createClient();
  const from = (page - 1) * PAGE_SIZE;

  const [list, unread] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, body, link, read_at, created_at", { count: "exact" })
      .eq("employee_id", me.id)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("employee_id", me.id).is("read_at", null),
  ]);

  const items = list.data ?? [];
  const total = list.count ?? 0;
  const unreadCount = unread.count ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description={unreadCount ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.` : "You're all caught up."}
        breadcrumbs={[{ label: "Home", href: "/home" }, { label: "Notifications" }]}
        actions={unreadCount > 0 ? <MarkAllReadButton /> : undefined}
      />
      <Card>
        {items.length ? (
          <>
            <NotificationList items={items} />
            <Pager page={page} pageSize={PAGE_SIZE} total={total} noun="notifications" hrefFor={(p) => `/notifications?page=${p}`} />
          </>
        ) : (
          <EmptyState
            icon={BellOff}
            title={page > 1 ? "Nothing on this page" : "No notifications yet"}
            description={page > 1 ? undefined : "We'll let you know here when there's an update on your requests or something needs your attention."}
          />
        )}
      </Card>
    </div>
  );
}
