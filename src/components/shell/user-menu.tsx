"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ClipboardList, ExternalLink, LayoutDashboard, LogOut, Mail, MailX, Moon, Sun } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { openAdminConsole, openMyRequests, setAway, setEmailNotifications, signOut } from "@/app/(desk)/_actions";
import type { DeskMode } from "@/lib/desk-mode";

export type ShellUser = { name: string; email: string; avatarUrl: string | null; designation: string | null; roleLabel: string };

export function UserMenu({
  user,
  mode,
  peopleSuccessUrl,
  isAgent,
  away,
  emailEnabled,
}: {
  user: ShellUser;
  /** Desk admins only; null for everyone else. */
  mode: DeskMode | null;
  peopleSuccessUrl: string;
  isAgent: boolean;
  away: boolean;
  emailEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={ref} className="relative ml-1">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu" className="rounded-full">
        <span className="relative block">
          <Avatar name={user.name} src={user.avatarUrl} size="sm" className="ring-slate-200" />
          {isAgent && (
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${away ? "bg-amber-400" : "bg-emerald-500"}`} title={away ? "Away" : "Available"} />
          )}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-[60] w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-1 text-[11px] font-medium text-primary-600">{user.roleLabel}</p>
          </div>
          {mode && (
            <form action={mode === "admin" ? openMyRequests : openAdminConsole} className="border-b border-slate-100">
              <button type="submit" className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50">
                {mode === "admin" ? <ClipboardList className="h-4 w-4 text-primary-600" /> : <LayoutDashboard className="h-4 w-4 text-primary-600" />}
                <span className="flex-1">{mode === "admin" ? "Switch to my requests" : "Back to admin console"}</span>
              </button>
            </form>
          )}
          {isAgent && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await setAway(!away);
                  if (res.ok) toast.success(away ? "You're available. New tickets can be assigned to you." : "You're away. Auto-assign will skip you.");
                  else toast.error(res.error);
                })
              }
              className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {away ? <Sun className="h-4 w-4 text-emerald-600" /> : <Moon className="h-4 w-4 text-amber-500" />}
              <span className="flex-1">{away ? "Set yourself available" : "Set yourself away"}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${away ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{away ? "Away" : "Available"}</span>
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await setEmailNotifications(!emailEnabled);
                if (res.ok) toast.success(emailEnabled ? "Emails off. You'll still see updates in the bell." : "Emails on. We'll email you about updates.");
                else toast.error(res.error);
              })
            }
            className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {emailEnabled ? <Mail className="h-4 w-4 text-primary-600" /> : <MailX className="h-4 w-4 text-slate-400" />}
            <span className="flex-1">Email notifications</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${emailEnabled ? "bg-primary-50 text-primary-700" : "bg-slate-100 text-slate-600"}`}>{emailEnabled ? "On" : "Off"}</span>
          </button>
          <a href={peopleSuccessUrl} className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
            <ExternalLink className="h-4 w-4 text-slate-400" /> Open People Success
          </a>
          <form action={signOut}>
            <button type="submit" className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
