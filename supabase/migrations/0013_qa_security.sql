-- QA security fixes. Idempotent: safe to re-run.
--  * servicedesk.schema_migrations (the migration ledger) was readable AND writable by every
--    signed-in user through the API (0001's blanket grant ran after the runner created it):
--    anyone could delete rows so old migrations re-run, or insert names so new ones are skipped.
--  * servicedesk.people is a read-only directory view; drop the write grants it inherited.
--  * TRUNCATE ignores RLS; API roles never need it (defence in depth).

revoke all on table servicedesk.schema_migrations from public, anon, authenticated;
alter table servicedesk.schema_migrations enable row level security;
grant all on table servicedesk.schema_migrations to service_role;

revoke insert, update, delete, truncate on servicedesk.people from public, anon, authenticated;
grant select on servicedesk.people to authenticated;

revoke truncate on all tables in schema servicedesk from anon, authenticated;
alter default privileges in schema servicedesk revoke truncate on tables from anon, authenticated;
