# Grevya Service Desk — design spec

Status: approved 2026-11-07 (built end to end in one pass, all four phases).

## Goal

An internal service desk for Grevya. IT runs it first; HR runs a second team on
the same desk and the old People Success HR helpdesk moves into it. Employees
sign in with their People Success (Grevya) account.

## Decisions

| Topic | Decision |
|---|---|
| Audience | Internal. Teams: **IT** (manages assets) and **HR**. Admins can add more teams. |
| App | Separate Next.js 16.4 app (`Service-Desk/`, repo `Grevya-Development/Service-Desk`), own Vercel project in `syd1`. Same look as People Success. |
| Data | Same Supabase project as People Success. All desk tables live in the **`servicedesk`** Postgres schema, exposed to PostgREST via `pgrst.db_schemas`. Reads `public.employees`, `departments`, `designations`, `locations`, `holidays`. |
| Migrations | Own runner (`npm run db:migrate`), tracked in `servicedesk.schema_migrations` — never in `supabase_migrations` (that belongs to People Success). |
| Auth | Supabase auth, same users. Must have a non-exited `public.employees` row, else `/no-access`. |
| HR helpdesk | Old tickets + comments imported into the HR team (`servicedesk.import_hr_helpdesk()`, re-runnable). People Success redirects to the desk once `NEXT_PUBLIC_SERVICE_DESK_URL` is set. Old tables are left untouched. |
| Email | Not in scope (no provider). In-app notifications in the desk; requester- and approver-facing ones are mirrored into People Success notifications. |

## Roles

| Role | Who | Can |
|---|---|---|
| Requester | Any active employee | Raise tickets / catalog requests, reply, attach files, reopen within 7 days of resolution, close own ticket, rate resolution, read published articles, see own assets |
| Approver | Requester's manager (manager approval) or team lead (lead approval) | Approve / reject requests waiting on them |
| Agent | Row in `team_members` | Work the team's tickets: reply, internal notes, assign, status / priority / category, transfer to another team, raise tickets on behalf of someone, write KB articles for their team |
| Team lead | `team_members.role = 'lead'` | Agent + manage team members, categories, SLA targets, catalog items, see reports |
| Asset manager | Agent of a team with `manages_assets` (IT) | Manage the asset register |
| Desk admin | `public.employees.role = 'super_admin'` | Everything; create teams, global settings |

All rules are enforced by RLS + guard triggers in the database; the UI mirrors them.

## Tickets

- Number: `SD-1001…` (identity from 1001). URLs use the number: `/requests/1001`, `/desk/tickets/1001`.
- Type: `incident` (something broken) or `request` (catalog item).
- Status: `new` → `open` → `pending` (waiting on requester, SLA paused) → `resolved` → `closed`.
  - Requester reply on a `pending` ticket moves it back to `open`.
  - Resolved tickets auto-close after 7 days. Requester may reopen within that window.
  - Rejected approvals close the ticket.
- Priority: `low | medium | high | urgent`.
- Optional link to an asset; catalog requests store `form_data` (jsonb).
- Auto-assign (per team, optional): new tickets go to the team agent with the fewest open tickets.
- Audit trail: `ticket_events`, written by trigger on every change.
- Messages: public replies or internal notes (agents only). Attachments (up to 5 files / 4 MB per message because of Vercel's request-size limit; private bucket `servicedesk`, served via short-lived signed URLs after an RLS check).
- Satisfaction: thumbs up / down + comment once resolved.

## SLA

- Targets per team × priority (`sla_policies`): first response and resolution, in business minutes.
  Defaults: urgent 30m / 4h, high 1h / 8h, medium 4h / 24h, low 8h / 40h.
- Business hours: global setting (Mon–Fri 09:30–18:30 Asia/Kolkata), skipping People Success public holidays.
- Computed in the database (`add_business_minutes`, `business_minutes_between`), so clients can't tamper.
- Clock starts at creation, or at approval for requests that need one. Time spent `pending` is added back.
- First response = first public reply by someone other than the requester.
- `run_sla_checks()` (idempotent): marks breaches, sends at-risk (≤25% time left) and breach notifications, auto-closes old resolved tickets. Runs from pg_cron when available, from `/api/cron/sla`, and opportunistically when the agent queue loads.

## Service catalog

- Items per team: name, description, icon, category, default priority, expected days, approval (`none | manager | team_lead`), custom fields (`text | textarea | number | date | select | checkbox`, required flag, options).
- Submitting creates a `request` ticket. With approval, an `approvals` row is created by trigger and the SLA waits until approved.
- Manager approval with no manager falls back to team-lead approval.

## Knowledge base

- Articles per team: title, summary, markdown body (safe subset renderer), tags, `draft | published | archived`, visibility `everyone | agents`.
- Full-text search (`search_articles(q)`), suggested while a requester types a ticket subject.
- Helpful yes/no per employee, view counter.

## Assets

- Register: tag, name, type, manufacturer, model, serial, status (`in_stock | assigned | in_repair | retired | lost`), assignee, location, purchase date / cost, vendor, warranty end, notes.
- History in `asset_events` (trigger). Tickets can link an asset; asset page lists its tickets. Requesters see their own assets.

## Reports (agents and leads)

KPIs and charts for a team and date range: volume over time, by category / priority, backlog by age, SLA compliance (response, resolution), median first response and resolution time, satisfaction %, agent workload. Aggregated server-side in TypeScript from RLS-filtered tickets.

## Screens

Help center (everyone): `/home`, `/requests/new`, `/catalog`, `/catalog/[id]`, `/requests`, `/requests/[number]`, `/kb`, `/kb/[slug]`, `/assets/mine`, `/approvals`, `/notifications`.
Agent workspace: `/desk` (queue views: unassigned, mine, all open, breaching soon, pending, resolved), `/desk/tickets/[number]`, `/desk/new`, `/desk/kb…`, `/desk/assets…`, `/desk/reports`.
Admin (leads / admins): `/admin/teams`, `/admin/categories`, `/admin/sla`, `/admin/catalog…`, `/admin/settings`.

## Testing

- Vitest: TypeScript helpers (formatting, markdown, report aggregation) and database tests against the local Supabase stack (business-hour maths, SLA triggers, RLS for requester vs agent vs other team).
- Browser QA of the main flows with the demo accounts.
- CI: typecheck, lint, unit tests, build.


## Round 2 (2026-11-07)

- **Incidents / service status** — `incidents`, `incident_updates`, `incident_subscribers`, `tickets.incident_id`; `/status` for everyone, `/desk/incidents` for agents, banner on Home / Report an issue / Catalog. `resolve_incident()` resolves linked tickets first, then posts the update, so each person gets one notification.
- **Followers / CC** — `ticket_followers`; followers can view, reply and get public updates (not close/reopen/rate).
- **Merge duplicates** — `merge_tickets()`; source closed with `merged_into`, its requester follows the target.
- **Transfers** — `transfer_ticket()` (RLS also checks the updated row, so moving a ticket out of your own teams needs this function).
- **Reply templates** — `canned_responses` with `{{first_name}}`, `{{ticket}}`, `{{agent_name}}`.
- **Agent availability** — `agent_profiles.away`; auto-assign skips away agents.
- **Pending follow-ups** — reminder after `pending_reminder_days` working days, auto-resolve after `pending_auto_resolve_days`; working-day length comes from business hours.
- **Notification hygiene** — messages written by the system don't notify on their own; the status change does.
- **Hardening** — security headers, `/api/health`, missing-configuration page, settings validation in the database.
