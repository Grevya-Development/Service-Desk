-- 0008: email notifications (sent through Resend by the app).
-- Every desk notification is queued for email. The database pings the app's dispatch endpoint
-- right after notifications are written (pg_net) and once a minute as a safety net (pg_cron);
-- the app claims a batch, sends it, and records the result with retries and backoff.

-- ---------------------------------------------------------------------------
-- Queue columns on notifications
-- ---------------------------------------------------------------------------
alter table servicedesk.notifications
  add column if not exists email_status text not null default 'pending'
    check (email_status in ('pending','sending','sent','failed','skipped')),
  add column if not exists email_attempts int not null default 0,
  add column if not exists email_next_at timestamptz not null default now(),
  add column if not exists email_claimed_at timestamptz,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_id text,
  add column if not exists email_error text;

-- Don't email anything that happened before email was switched on.
update servicedesk.notifications set email_status = 'skipped', email_error = 'Created before email was enabled' where email_status = 'pending';

create index if not exists notifications_email_queue on servicedesk.notifications (email_next_at) where email_status = 'pending';

-- ---------------------------------------------------------------------------
-- Personal preference: email on (default) or off
-- ---------------------------------------------------------------------------
create table servicedesk.notification_preferences (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table servicedesk.notification_preferences enable row level security;
create policy notification_prefs_own on servicedesk.notification_preferences for all to authenticated
  using (employee_id = servicedesk.me()) with check (employee_id = servicedesk.me());
grant select, insert, update, delete on servicedesk.notification_preferences to authenticated;
grant all on servicedesk.notification_preferences to service_role;
create trigger notification_prefs_touch before update on servicedesk.notification_preferences for each row execute function servicedesk.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Private settings: readable by the service role only (no grants, no policies)
-- ---------------------------------------------------------------------------
create table servicedesk.private_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table servicedesk.private_settings enable row level security;
revoke all on servicedesk.private_settings from authenticated, anon;
grant all on servicedesk.private_settings to service_role;
insert into servicedesk.private_settings (key, value)
values ('email_dispatch_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Where the database pings the app ('' = use app_url + /api/email/dispatch).
insert into servicedesk.settings (key, value) values ('email_dispatch_url', '""') on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Claim a batch of emails to send (service role only)
-- ---------------------------------------------------------------------------
create or replace function servicedesk.claim_email_batch(p_limit int default 50)
returns table (id uuid, employee_id uuid, email text, full_name text, title text, body text, link text, created_at timestamptz, attempts int)
language plpgsql security definer set search_path = servicedesk, public as $$
#variable_conflict use_column
begin
  -- Release claims abandoned by a crashed run.
  update servicedesk.notifications set email_status = 'pending'
   where email_status = 'sending' and email_claimed_at < now() - interval '10 minutes';

  -- People who switched email off, have left, or have no address: skip.
  update servicedesk.notifications n
     set email_status = 'skipped',
         email_error = case when exists (select 1 from servicedesk.notification_preferences p where p.employee_id = n.employee_id and not p.email_enabled)
                            then 'Email turned off by the person' else 'No active employee email' end
   where n.email_status = 'pending'
     and (exists (select 1 from servicedesk.notification_preferences p where p.employee_id = n.employee_id and not p.email_enabled)
          or not exists (select 1 from public.employees e where e.id = n.employee_id and e.status <> 'exited' and coalesce(e.email, '') <> ''));

  return query
  with picked as (
    select n.id from servicedesk.notifications n
    where n.email_status = 'pending' and n.email_next_at <= now()
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update skip locked
  )
  update servicedesk.notifications n
     set email_status = 'sending', email_attempts = n.email_attempts + 1, email_claimed_at = now()
    from picked, public.employees e
   where n.id = picked.id and e.id = n.employee_id
  returning n.id, n.employee_id, e.email, e.full_name, n.title, n.body, n.link, n.created_at, n.email_attempts;
end $$;
revoke execute on function servicedesk.claim_email_batch(int) from public, anon, authenticated;
grant execute on function servicedesk.claim_email_batch(int) to service_role;

-- ---------------------------------------------------------------------------
-- Ping the app to send now (never blocks or fails the notification insert)
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not available (%); emails go out on the once-a-minute check instead', sqlerrm;
end $$;

create or replace function servicedesk.ping_email_dispatch()
returns void language plpgsql security definer set search_path = servicedesk, public as $$
declare
  url text;
  secret text;
begin
  select nullif(value #>> '{}', '') into url from servicedesk.settings where key = 'email_dispatch_url';
  if url is null then
    select nullif(value #>> '{}', '') into url from servicedesk.settings where key = 'app_url';
    if url is not null then url := rtrim(url, '/') || '/api/email/dispatch'; end if;
  end if;
  if url is null then return; end if;
  if not exists (select 1 from servicedesk.notifications where email_status = 'pending' and email_next_at <= now()) then return; end if;
  select value into secret from servicedesk.private_settings where key = 'email_dispatch_secret';
  perform net.http_post(
    url := url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', coalesce(secret, '')),
    timeout_milliseconds := 10000
  );
exception when others then
  null; -- email is best-effort; the minute check retries
end $$;
revoke execute on function servicedesk.ping_email_dispatch() from public, anon, authenticated;
grant execute on function servicedesk.ping_email_dispatch() to service_role;

create or replace function servicedesk.notifications_after_insert_ping()
returns trigger language plpgsql security definer set search_path = servicedesk as $$
begin
  perform servicedesk.ping_email_dispatch();
  return null;
end $$;
create trigger notifications_email_ping after insert on servicedesk.notifications
  for each statement execute function servicedesk.notifications_after_insert_ping();

do $$
begin
  perform cron.schedule('servicedesk-email-dispatch', '* * * * *', 'select servicedesk.ping_email_dispatch()');
exception when others then
  raise notice 'pg_cron not available (%); rely on the instant ping and Vercel Cron', sqlerrm;
end $$;

notify pgrst, 'reload schema';
