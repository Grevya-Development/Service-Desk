# Changelog

All notable changes to the Grevya Service Desk. Versions follow [Semantic Versioning](https://semver.org/).

## [1.0.1] — 2026-11-07

### Fixed
- Docker image build: test configuration files are no longer included in the image (the 1.0.0 image failed to build).

## [1.0.0] — 2026-11-07

First release. Internal IT and HR service desk on the People Success Supabase project (`servicedesk` schema), signed in with People Success accounts.

### Help center (every employee)
- Report an issue with help articles suggested while typing, urgency in plain language, device link, and paste / drag-and-drop screenshots.
- Service catalog with dynamic forms and manager or team-lead approval.
- My requests: reply, attach files, close, reopen within 7 days, rate the help; Following tab for requests you're CC'd on.
- Knowledge base with search and "Was this helpful?".
- My assets, approvals for managers, search, notifications (also mirrored to People Success).
- Service status page and incident banner with "I'm affected — notify me".

### Agent workspace
- Queue sorted by SLA urgency with views (unassigned, mine, breaching soon, pending, awaiting approval, resolved), filters, bulk actions and CSV export.
- Ticket workspace: replies and internal notes, reply templates with placeholders, article links, properties, resolve / pending, transfer between teams, merge duplicates, followers, incident links, keyboard shortcuts.
- Raise tickets on behalf of employees; away status (auto-assign skips you).
- Incident management, reply templates, help-article editor, IT asset register with history and CSV export, reports with charts and ticket export.

### Administration
- Teams and agents (auto-assign, availability), categories, SLA targets in business hours, service catalog builder with live preview.
- Settings: business hours, app URL, auto-close, pending reminders and auto-resolve, HR Helpdesk import.

### Email
- Every desk notification is also emailed through Resend: batched, idempotent, retried with backoff, sent within seconds (database ping) with a once-a-minute safety net.
- Personal on/off switch in the account menu; admin email card with queue counts, last failure, test email and "send now".
- Safe by default: no backlog blast at launch, allowlist-only outside production.

### Platform
- SLA engine in the database: business hours, public holidays from People Success, pause while waiting on the requester, breach and at-risk alerts, auto-close.
- Row-level security and guard triggers for every rule; one notification per event.
- Security headers, `/api/health`, configuration check, trimmed environment values.
- Own migration runner (`servicedesk.schema_migrations`), demo seed, 20 database tests, 42 unit tests, 54 Playwright end-to-end journeys.
- Docker image published to GitHub Packages on every version tag; runtime configuration only.

[1.0.1]: https://github.com/Grevya-Development/Service-Desk/releases/tag/v1.0.1
[1.0.0]: https://github.com/Grevya-Development/Service-Desk/releases/tag/v1.0.0
