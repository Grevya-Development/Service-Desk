"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
  BookOpenCheck,
  CheckSquare,
  ClipboardList,
  Cog,
  FolderTree,
  HardDrive,
  Home,
  Inbox,
  LayoutGrid,
  Laptop,
  Menu,
  PlusCircle,
  ShoppingBag,
  TicketPlus,
  Timer,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon, NavSection } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { NotificationsMenu, type NotificationItem } from "./notifications-menu";
import { UserMenu, type ShellUser } from "./user-menu";
import { HeaderSearch } from "./header-search";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: Home,
  plus: PlusCircle,
  catalog: ShoppingBag,
  requests: ClipboardList,
  kb: BookOpen,
  laptop: Laptop,
  approvals: CheckSquare,
  queue: Inbox,
  "ticket-plus": TicketPlus,
  "kb-edit": BookOpenCheck,
  assets: HardDrive,
  reports: BarChart3,
  teams: Users,
  categories: FolderTree,
  sla: Timer,
  "catalog-admin": LayoutGrid,
  settings: Cog,
};

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

function NavList({ sections, pathname, onNavigate }: { sections: NavSection[]; pathname: string; onNavigate?: () => void }) {
  // Longest matching href wins so /requests/new doesn't also light up /requests.
  const all = sections.flatMap((s) => s.items);
  const active = all.filter((i) => isActive(pathname, i.href, i.exact)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="space-y-6">
      {sections.map((s) => (
        <div key={s.title}>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/45">{s.title}</p>
          <ul className="space-y-0.5">
            {s.items.map((item) => {
              const Icon = ICONS[item.icon];
              const on = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                      on ? "bg-white text-navy-900 shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {!!item.badge && (
                      <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", on ? "bg-primary-600 text-white" : "bg-brand-red text-white")}>{item.badge}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DeskShell({
  sections,
  user,
  notifications,
  unread,
  isAgent,
  children,
}: {
  sections: NavSection[];
  user: ShellUser;
  notifications: NotificationItem[];
  unread: number;
  isAgent: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

  return (
    <div className="min-h-screen">
      <header className="no-print fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-3 border-b border-slate-200/70 bg-white/95 px-3 backdrop-blur sm:px-4">
        <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/home" className="flex shrink-0 items-center gap-2.5 lg:w-[252px] lg:pl-3">
          <Image src="/grevya-logo.png" alt="Grevya" width={120} height={60} className="h-10 w-auto" priority />
          <span className="hidden border-l border-slate-200 pl-2.5 text-[13px] font-semibold leading-tight text-slate-600 sm:block">
            Service
            <br />
            Desk
          </span>
        </Link>
        <div className="flex min-w-0 flex-1 justify-center px-1">
          <HeaderSearch isAgent={isAgent} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <NotificationsMenu items={notifications} unread={unread} />
          <UserMenu user={user} />
        </div>
      </header>

      <aside className="no-print fixed bottom-0 left-0 top-16 z-30 hidden w-[264px] overflow-y-auto bg-navy-900 px-3 py-5 thin-scroll lg:block">
        <NavList sections={sections} pathname={pathname} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="animate-in absolute inset-y-0 left-0 w-[280px] max-w-[85vw] overflow-y-auto bg-navy-900 px-3 py-4">
            <div className="mb-4 flex items-center justify-between px-2">
              <span className="text-sm font-semibold text-white">Service Desk</span>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-white/70 hover:bg-white/10" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList sections={sections} pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="pt-16 lg:pl-[264px] print:p-0">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
