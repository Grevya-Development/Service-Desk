# Service Desk: code conventions

Read `docs/spec.md` first. Stack: Next.js **16.4** (App Router, React 19.3, Tailwind v4) + Supabase.
This Next.js has breaking changes vs. older versions: read `node_modules/next/dist/docs/` when unsure.
`params` / `searchParams` are **Promises** (`const { id } = await params`); middleware is `src/proxy.ts`.

## Layout
- `src/app/(desk)/…` is every signed-in page. The layout renders header + navy sidebar; pages render only content.
- Routes are listed in `src/lib/nav.ts`. Build exactly those hrefs.
- Module-private code: `src/app/(desk)/<area>/_components/`, `_lib/`, and server actions in `src/app/(desk)/<area>/actions.ts` (`"use server"`).
- **Shared files are frozen** (`src/components/ui/*`, `src/components/shell/*`, `src/components/tickets/*`, `src/components/markdown.tsx`, `src/lib/*`, `src/app/(desk)/layout.tsx`, migrations). If you need something shared, make it inside your area. If you find a bug in a shared file or need a database change, describe it in your final report instead of editing.

## Data access
- `const supabase = await createClient()` from `@/lib/supabase/server`. It defaults to the **`servicedesk`** schema. People Success tables: `supabase.schema("public").from("employees")…`.
- Employee details from desk tables: embed the `people` view with a column hint: `requester:people!requester_id(full_name, email, avatar_url, department, designation)`. Columns on `people`: `id, full_name, first_name, email, employee_code, avatar_url, phone, status, role, manager_id, location_id, department_id, department, designation, location`.
- Listing employees (pickers): `supabase.from("people").select("id, full_name, email, department, designation, avatar_url").neq("status", "exited").order("full_name")`.
- Types: `import type { Tables, TablesInsert } from "@/lib/database.types"` → `Tables<{ schema: "servicedesk" }, "tickets">`.
- Current user: `const me = await requireViewer()` (or `requireAgent()`, `requireLead()`, `requireAdmin()`, `requireAssetManager()`) from `@/lib/auth`. `me.id` is the **employee id**. Also `me.agentTeamIds`, `me.leadTeamIds`, `me.memberships`, `me.isAgent`, `me.isLead`, `me.isAdmin`, `me.managesAssets`.
- **RLS + triggers enforce everything** (see `supabase/migrations/0001_init.sql`). The UI mirrors the rules; server actions still re-check and return friendly errors.
- The database owns SLA fields (`first_response_due`, `resolution_due`, breached flags, `resolved_at`, `closed_at`, `pending_since`, `sla_paused_minutes`) and `ticket_events`. Never write those from the app.
- Status changes: just update `status`; triggers stamp times, pause/resume SLA, log events, notify.
- Approvals: `supabase.rpc("decide_approval", { p_id, p_approve, p_comment })`.
- KB search: `searchArticles(q)` from `@/lib/kb/search` or `supabase.rpc("search_articles", { q, lim })`.
- Attachments: `filesFrom(fd)` + `validateFiles(files)` from `@/lib/storage`, then after the row exists `attachFiles(ticketId, files, messageId|null)` from `@/lib/tickets/files`. Signed URLs: `signedUrls(paths)`.
- Ticket screens: `loadTicket(number)` from `@/lib/tickets/load` returns `{ ticket, timeline, ticketAttachments, approvals }` (calls notFound()). `TICKET_SELECT` / `PERSON_COLUMNS` are exported for list queries.
- Replies / reopen / close / rate: `postMessage`, `setOwnTicketStatus`, `rateTicket` from `@/lib/tickets/actions`.

## Server actions
```ts
"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ok, fail, dbError, type ActionState } from "@/lib/actions";
import { str, num, bool } from "@/lib/utils";

export async function doThing(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getViewer();
  if (!me) return fail("Not signed in");
  const name = str(fd, "name");
  if (!name) return fail("Name is required");
  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert({ ... });
  if (error) return fail(dbError(error));
  revalidatePath("/admin/categories");
  return ok("Saved", "/optional/redirect");
}
```
Validate every input (actions are public POST endpoints), return `fail()` instead of throwing, validate UUIDs with a regex before querying.

## UI kit (`@/components/ui`)
- Server-safe: `Button, buttonClass, Card, CardHeader, CardBody, WidgetCard, Badge, StatusBadge, Label, Input, Textarea, Select, Checkbox, Field, FormGrid, Table, THead, TBody, TR, TH, TD, EmptyState, PageHeader, Avatar, StatCard, ProgressBar, ProgressRing`.
- Client: `ActionForm` + `SubmitButton` (`@/components/ui/action-form`), `ActionButton` (`@/components/ui/action-button`, supports `prompt`, `confirm`, `fields`), `Dialog` (`@/components/ui/dialog`), `LinkTabs` (`@/components/ui/link-tabs`).
- Tickets (`@/components/tickets/*`): `TicketStatusBadge` (audience `"agent" | "requester"`), `PriorityBadge`, `PriorityDot`, `ApprovalBadge`, `SlaBadge`; `Conversation`, `AttachmentList`, `formatBytes`; `Composer` (client; `canNote` for agents).
- `Markdown` / `excerpt` from `@/components/markdown` (safe subset, no raw HTML).
- Helpers: `@/lib/utils` (`formatDate, formatDateTime, humanize, initials, cn, str, num, bool, orgToday`), `@/lib/constants` (statuses, priorities, `ticketRef`, asset types/statuses, catalog field types), `@/lib/sla` (`slaStates`, `primarySla`, `formatDuration`, `formatTarget`).
- Icons: `lucide-react`. Charts: `recharts`.

## Look & feel
Light canvas, white `rounded-xl` cards, slate greys, primary blue `primary-600`, navy sidebar. Each team has a `color` (IT `#2d48c8`, HR `#c2410c`): use it for small accents (team chips, card top bars). Pages start with `<PageHeader title breadcrumbs actions />`. Every list needs an empty state. Pages must work at phone width (stack columns; tables scroll horizontally inside `Table`). Write copy for non-technical employees: short, plain, no jargon.

## Verifying your work
- `npx tsc --noEmit` and `npx eslint <your folders>` must pass.
- Do **not** run `next build` or start another dev server (one runs on :3200 against the local database). Do not touch the remote database.
- You may query the **local** DB to check data shapes: `.env.local` has `SUPABASE_DB_URL` (postgres) and local Supabase keys. Put throwaway scripts in `.tmp/`.
- Demo logins (password `Grevya@123`): `priya@` employee (manager `kavin@`), `manoj@` / `lakshmi@` IT agents, `arvind@` IT lead, `hr@` / `divya@` HR leads, `admin@` desk admin.

## Round 2 additions (migration 0004)
- **Incidents** (`incidents`, `incident_updates`, `incident_subscribers`; `tickets.incident_id`). Agents of the team insert/update incidents; posting an `incident_updates` row moves the incident's status and notifies subscribers + requesters of linked open tickets. Resolve with `rpc("resolve_incident", { p_id, p_message, p_resolve_tickets })` (returns number of tickets resolved). Employees subscribe with an `incident_subscribers` insert of their own id ("I'm affected / notify me").
- **Followers / CC** (`ticket_followers`): requester or agent adds; follower or requester/agent removes. Followers can view the ticket, reply publicly, and get public updates. Max 20 per ticket. Helper `is_ticket_follower(ticket)`.
- **Merge duplicates**: `rpc("merge_tickets", { p_source, p_target })` closes the source, sets `merged_into`, posts notes and makes the source requester a follower of the target.
- **Reply templates** (`canned_responses`: team_id, title, body, use_count). Agents of the team CRUD them; call `rpc("record_canned_use", { p_id })` when one is inserted.
- **Agent availability** (`agent_profiles`: employee_id, away, away_until). Auto-assign skips away agents. Toggle exists in the user menu (`setAway` in `src/app/(desk)/_actions.ts`).
- **Pending follow-ups** (automatic, in `run_sla_checks`): reminder to the requester after `pending_reminder_days` working days, auto-resolve after `pending_auto_resolve_days` (settings rows, defaults 3 and 5).
- New ticket event kinds: `follower`, `incident`, `merged`.
- New routes in the nav: `/status` (everyone), `/desk/incidents`, `/desk/templates` (agents). `/api/health` is public.

## Testing in a real browser (each engineer uses their own browser)
Do NOT use the shared `browse` CLI. Write Playwright scripts in `.tmp/` that import
`/Users/kavinnr/.claude/skills/gstack/node_modules/playwright/index.mjs` and launch your own `chromium` (headless).
The dev server runs at http://localhost:3200 against the local database. Sign in by filling `input[name=email]`,
`input[name=password]` (`Grevya@123`) and clicking `button[type=submit]`, then `waitForURL(/\/home/)`.
Listen to `page.on("pageerror")` and console errors. Take screenshots with `page.screenshot({ path })` and look at them.
