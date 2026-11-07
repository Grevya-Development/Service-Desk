"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, LogOut } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { signOut } from "@/app/(desk)/_actions";

export type ShellUser = { name: string; email: string; avatarUrl: string | null; designation: string | null; roleLabel: string };

export function UserMenu({ user, peopleSuccessUrl }: { user: ShellUser; peopleSuccessUrl: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={ref} className="relative ml-1">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu" className="rounded-full">
        <Avatar name={user.name} src={user.avatarUrl} size="sm" className="ring-slate-200" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-[60] w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-1 text-[11px] font-medium text-primary-600">{user.roleLabel}</p>
          </div>
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
