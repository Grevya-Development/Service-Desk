"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { Avatar, Button, Card, CardBody, CardHeader } from "@/components/ui";
import type { ActionState } from "@/lib/actions";
import { cn } from "@/lib/utils";
import { addFollower, removeFollower, searchPeople, type PersonHit } from "../actions";

export type FollowerView = { id: string; full_name: string | null; email: string; avatar_url: string | null; designation: string | null };

/**
 * "People following this request": avatars + names. The requester can add
 * colleagues and remove them; a follower can stop following.
 */
export function FollowersPanel({
  ticketId,
  meId,
  requesterId,
  requesterName,
  followers,
  canManage,
  canAdd,
}: {
  ticketId: string;
  meId: string;
  requesterId: string;
  requesterName: string;
  followers: FollowerView[];
  /** Requester: may add and remove people. */
  canManage: boolean;
  /** False once the request is closed. */
  canAdd: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  const run = (action: (p: ActionState, fd: FormData) => Promise<ActionState>, employeeId: string) => {
    const fd = new FormData();
    fd.set("ticket_id", ticketId);
    fd.set("employee_id", employeeId);
    setBusy(employeeId);
    startTransition(async () => {
      let res: ActionState;
      try {
        res = await action(null, fd);
      } catch {
        res = { ok: false, error: "Something went wrong. Please try again." };
      }
      setBusy(null);
      if (res?.ok) {
        toast.success(res.message ?? "Done");
        if (res.redirectTo) router.push(res.redirectTo);
      } else toast.error(res?.error ?? "Something went wrong. Please try again.");
    });
  };

  const exclude = new Set([requesterId, ...followers.map((f) => f.id)]);

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-400" aria-hidden /> People following this request
          </span>
        }
        description={followers.length ? `${followers.length} ${followers.length === 1 ? "person gets" : "people get"} updates and can reply, as well as ${canManage ? "you" : requesterName}.` : undefined}
      />
      <CardBody className="space-y-3">
        {followers.length > 0 ? (
          <ul className="space-y-2.5">
            {followers.map((f) => {
              const isMe = f.id === meId;
              const removable = canManage || isMe;
              return (
                <li key={f.id} className="flex items-center gap-3">
                  <Avatar name={f.full_name ?? f.email} src={f.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {f.full_name ?? f.email}
                      {isMe && <span className="font-normal text-slate-500"> (you)</span>}
                    </p>
                    {f.designation && <p className="truncate text-xs text-slate-500">{f.designation}</p>}
                  </div>
                  {removable && (
                    <button
                      type="button"
                      onClick={() => run(removeFollower, f.id)}
                      disabled={busy === f.id}
                      aria-label={isMe ? "Stop following this request" : `Remove ${f.full_name ?? f.email}`}
                      title={isMe ? "Stop following" : "Remove"}
                      className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
                    >
                      {busy === f.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : isMe ? <UserMinus className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            {!canManage
              ? `Only ${requesterName} gets updates.`
              : canAdd
                ? "Only you get updates. Add a colleague who should be kept in the loop, like your manager or a teammate."
                : "Only you got updates on this request."}
          </p>
        )}

        {canManage &&
          canAdd &&
          (adding ? (
            <PeoplePicker
              exclude={exclude}
              busy={busy !== null}
              onPick={(p) => run(addFollower, p.id)}
              onClose={() => setAdding(false)}
            />
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)} disabled={followers.length >= 20}>
              <UserPlus className="h-4 w-4" aria-hidden /> {followers.length >= 20 ? "Up to 20 people can follow" : "Add people"}
            </Button>
          ))}
      </CardBody>
    </Card>
  );
}

function PeoplePicker({ exclude, busy, onPick, onClose }: { exclude: Set<string>; busy: boolean; onPick: (p: PersonHit) => void; onClose: () => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const req = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const results = hits.filter((h) => !exclude.has(h.id));
  const term = q.trim();

  const onType = (value: string) => {
    setQ(value);
    setActive(0);
    if (timer.current) clearTimeout(timer.current);
    const t = value.trim();
    const n = ++req.current;
    // Drop results for the previous text right away, so Enter can't pick a stale match.
    setHits([]);
    if (t.length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => {
      searchPeople(t)
        .then((r) => n === req.current && setHits(r))
        .catch(() => n === req.current && setHits([]))
        .finally(() => n === req.current && setLoading(false));
    }, 250);
  };

  const pick = (p: PersonHit | undefined) => {
    if (!p || busy || loading) return;
    onPick(p);
    setQ("");
    setHits([]);
  };

  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={results[active] ? `${id}-opt-${results[active].id}` : undefined}
          aria-autocomplete="list"
          aria-label="Search colleagues by name or email"
          autoFocus
          autoComplete="off"
          value={q}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Type a name or email…"
          className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-8 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        />
        {(loading || busy) && <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" aria-hidden />}
      </div>
      <ul id={`${id}-list`} role="listbox" aria-label="Colleagues" className="mt-1 max-h-60 overflow-y-auto">
        {results.map((p, i) => (
          <li
            key={p.id}
            id={`${id}-opt-${p.id}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(p)}
            className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5", i === active ? "bg-primary-50" : "hover:bg-slate-50")}
          >
            <Avatar name={p.full_name ?? p.email} src={p.avatar_url} size="xs" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-slate-800">{p.full_name ?? p.email}</span>
              <span className="block truncate text-xs text-slate-500">{[p.designation, p.department].filter(Boolean).join(" · ") || p.email}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="px-1 pt-1 text-xs text-slate-500" aria-live="polite">
        {term.length < 2 ? "Type at least 2 letters." : loading ? "Searching…" : results.length ? null : hits.length ? "Everyone matching is already following." : `No one found for “${term}”.`}
      </p>
      <div className="mt-1 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
