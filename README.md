# Grevya Service Desk

Internal service desk for Grevya. IT and HR run their queues here; every employee
signs in with their People Success account to report issues, request services,
read help articles and see their assigned devices.

- **Help center** (everyone): report an issue, service catalog, my requests, knowledge base, my assets, approvals.
- **Agent workspace**: ticket queue with SLA timers, ticket workspace (replies, internal notes, assignment, transfers), raise tickets on behalf of people, article management, asset register, reports.
- **Administration** (team leads / desk admins): teams and agents, categories, SLA targets, service catalog builder, business hours, HR helpdesk import.
- **Service status**: agents declare incidents ("Email is down — we're on it"); everyone sees a banner, can tap "I'm affected", and gets one notification when it's fixed. Resolving an incident can resolve every linked ticket at once.
- **Less typing for agents**: reply templates with placeholders, article links, bulk actions, merge duplicates, keyboard shortcuts (`?`), CSV exports, paste/drag-drop screenshots.
- **Followers / CC** on requests, **away status** (auto-assign skips you), automatic **reminders** and auto-resolve for tickets waiting on the requester.

Design: [`docs/spec.md`](docs/spec.md). Code conventions: [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

## How it fits with People Success

| | |
|---|---|
| Database | Same Supabase project. All desk tables live in the `servicedesk` schema; it reads `public.employees`, departments, designations, locations and holidays. |
| Sign-in | Same Supabase users. Anyone with an active employee record can sign in. |
| Roles | Desk admin = People Success `super_admin`. Agents and team leads are managed in **Administration → Teams & agents**. |
| HR helpdesk | Old HR tickets are imported into the HR team (`servicedesk.import_hr_helpdesk()`, re-runnable). Set `NEXT_PUBLIC_SERVICE_DESK_URL` in People Success to redirect its helpdesk pages here. |
| Notifications | In-app bell here; updates for requesters and approvers are also copied to People Success notifications (needs **Settings → App URL**). |

## Local development

Uses the People Success local Supabase stack (Docker).

```bash
cd ../app && npx supabase start          # People Success stack on 554xx ports
cd ../Service-Desk
cp .env.example .env.local               # fill with the local keys from `npx supabase status`
npm install
npm run db:migrate                       # applies supabase/migrations/*.sql (tracked in servicedesk.schema_migrations)
npm run db:seed                          # demo agents, catalog, articles, assets, tickets (local only)
npm run dev                              # http://localhost:3200
```

Demo logins (password `Grevya@123`): `priya@grevya.com` employee · `kavin@` manager/approver · `manoj@`, `lakshmi@` IT agents · `arvind@` IT lead · `hr@` HR lead · `divya@` HR agent · `admin@` desk admin.

Checks: `npm run typecheck`, `npm run lint`, `npm test` (unit + database tests; database tests run when `.env.local` points at the local stack), `npm run test:e2e` (Playwright end-to-end journeys against the local stack; reseeds demo data first).

Health check: `GET /api/health` → `{ ok, database, latencyMs }` (public, no data).

## Deploying

1. **Database** (once per environment): `SUPABASE_DB_URL=<pooler url> node scripts/migrate.mjs`.
   The migration also adds `servicedesk` to the Data API's exposed schemas (`pgrst.db_schemas`).
   If you later edit *Exposed schemas* in the Supabase dashboard, keep `servicedesk` in the list.
2. **Vercel**: import the repo, framework Next.js, region is pinned to `syd1` by `vercel.json` (next to the database).
   Environment variables (none use the `NEXT_PUBLIC_` prefix; everything stays on the server): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `PEOPLE_SUCCESS_URL`. Optional: `SHOW_DEMO_LOGINS=true` (never in production).
3. In the desk: **Administration → Settings** → set the App URL, add IT agents in **Teams & agents**, then **Import HR Helpdesk tickets**.
4. In People Success (Vercel env): set `NEXT_PUBLIC_SERVICE_DESK_URL=<desk url>` and redeploy.
5. Supabase Auth → URL configuration: add the desk URL to the redirect allow-list (password reset links).

SLA checks run every 5 minutes via pg_cron when the extension is enabled, daily via Vercel Cron, and whenever an agent opens the queue.
