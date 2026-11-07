-- Grevya Service Desk: schema, SLA engine, access rules, notifications.
-- Lives in its own `servicedesk` schema inside the People Success Supabase project.
-- Reads public.employees / departments / designations / locations / holidays.

create schema if not exists servicedesk;
grant usage on schema servicedesk to authenticated, service_role;

-- ===========================================================================
-- Settings
-- ===========================================================================
create table servicedesk.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into servicedesk.settings (key, value) values
  ('business_hours', '{"days":[1,2,3,4,5],"start":"09:30","end":"18:30","timezone":"Asia/Kolkata"}'),
  ('app_url', '""'),
  ('auto_close_days', '7'),
  ('sla_last_run', '"1970-01-01T00:00:00Z"')
on conflict (key) do nothing;

-- ===========================================================================
-- Identity helpers (security definer: they read public.employees directly)
-- ===========================================================================
create or replace function servicedesk.me()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid() and status <> 'exited' limit 1
$$;

create or replace function servicedesk.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from public.employees where user_id = auth.uid() limit 1), false)
$$;

-- ===========================================================================
-- Teams
-- ===========================================================================
create table servicedesk.teams (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_-]{1,30}$'),
  name text not null check (length(name) between 2 and 60),
  description text,
  color text not null default '#2d48c8',
  icon text not null default 'life-buoy',
  manages_assets boolean not null default false,
  auto_assign boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table servicedesk.team_members (
  team_id uuid not null references servicedesk.teams(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role text not null default 'agent' check (role in ('agent','lead')),
  created_at timestamptz not null default now(),
  primary key (team_id, employee_id)
);
create index on servicedesk.team_members (employee_id);

create or replace function servicedesk.is_agent(p_team uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select servicedesk.is_admin() or exists (
    select 1 from servicedesk.team_members m where m.team_id = p_team and m.employee_id = servicedesk.me()
  )
$$;

create or replace function servicedesk.is_lead(p_team uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select servicedesk.is_admin() or exists (
    select 1 from servicedesk.team_members m where m.team_id = p_team and m.employee_id = servicedesk.me() and m.role = 'lead'
  )
$$;

create or replace function servicedesk.is_any_agent()
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select servicedesk.is_admin() or exists (select 1 from servicedesk.team_members m where m.employee_id = servicedesk.me())
$$;

create or replace function servicedesk.manages_assets()
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select servicedesk.is_admin() or exists (
    select 1 from servicedesk.team_members m join servicedesk.teams t on t.id = m.team_id
    where m.employee_id = servicedesk.me() and t.manages_assets and t.active
  )
$$;

-- ===========================================================================
-- Categories, SLA policies
-- ===========================================================================
create table servicedesk.categories (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references servicedesk.teams(id) on delete cascade,
  name text not null check (length(name) between 2 and 60),
  description text,
  active boolean not null default true,
  sort_order int not null default 0,
  unique (team_id, name)
);

create table servicedesk.sla_policies (
  team_id uuid not null references servicedesk.teams(id) on delete cascade,
  priority text not null check (priority in ('low','medium','high','urgent')),
  first_response_mins int not null check (first_response_mins between 1 and 100000),
  resolution_mins int not null check (resolution_mins between 1 and 500000),
  primary key (team_id, priority),
  check (resolution_mins >= first_response_mins)
);

-- ===========================================================================
-- Business-hours maths (used by the SLA engine)
-- ===========================================================================
create or replace function servicedesk.business_hours()
returns jsonb language sql stable security definer set search_path = servicedesk as $$
  select coalesce((select value from servicedesk.settings where key = 'business_hours'),
    '{"days":[1,2,3,4,5],"start":"09:30","end":"18:30","timezone":"Asia/Kolkata"}'::jsonb)
$$;

create or replace function servicedesk.is_holiday(p_day date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.holidays h where h.date = p_day and h.type = 'public' and h.location_id is null)
$$;

-- Adds `p_minutes` working minutes to `p_start`, skipping nights, weekends and public holidays.
create or replace function servicedesk.add_business_minutes(p_start timestamptz, p_minutes numeric)
returns timestamptz language plpgsql stable security definer set search_path = servicedesk, public as $$
declare
  cfg jsonb := servicedesk.business_hours();
  tz text := cfg->>'timezone';
  d_start time := (cfg->>'start')::time;
  d_end time := (cfg->>'end')::time;
  work_days int[] := array(select jsonb_array_elements_text(cfg->'days')::int);
  local_ts timestamp := p_start at time zone tz;
  d date := local_ts::date;
  cur time := local_ts::time;
  remaining numeric := greatest(coalesce(p_minutes, 0), 0);
  win_start time;
  avail numeric;
  guard int := 0;
begin
  if p_start is null then return null; end if;
  loop
    guard := guard + 1;
    if guard > 2000 then raise exception 'Business hours are misconfigured'; end if;
    if extract(isodow from d)::int = any(work_days) and not servicedesk.is_holiday(d) then
      win_start := greatest(cur, d_start);
      if win_start < d_end then
        avail := extract(epoch from (d_end - win_start)) / 60;
        if remaining <= avail then
          return ((d + win_start) + make_interval(secs => remaining * 60)) at time zone tz;
        end if;
        remaining := remaining - avail;
      end if;
    end if;
    d := d + 1;
    cur := time '00:00';
  end loop;
end $$;

-- Working minutes between two instants.
create or replace function servicedesk.business_minutes_between(p_from timestamptz, p_to timestamptz)
returns int language plpgsql stable security definer set search_path = servicedesk, public as $$
declare
  cfg jsonb := servicedesk.business_hours();
  tz text := cfg->>'timezone';
  d_start time := (cfg->>'start')::time;
  d_end time := (cfg->>'end')::time;
  work_days int[] := array(select jsonb_array_elements_text(cfg->'days')::int);
  d date;
  last_day date;
  ws timestamptz;
  we timestamptz;
  total numeric := 0;
begin
  if p_from is null or p_to is null or p_to <= p_from then return 0; end if;
  d := (p_from at time zone tz)::date;
  last_day := (p_to at time zone tz)::date;
  while d <= last_day loop
    if extract(isodow from d)::int = any(work_days) and not servicedesk.is_holiday(d) then
      ws := greatest((d + d_start) at time zone tz, p_from);
      we := least((d + d_end) at time zone tz, p_to);
      if we > ws then total := total + extract(epoch from (we - ws)) / 60; end if;
    end if;
    d := d + 1;
  end loop;
  return round(total)::int;
end $$;

-- ===========================================================================
-- Assets
-- ===========================================================================
create table servicedesk.assets (
  id uuid primary key default gen_random_uuid(),
  asset_tag text not null unique check (length(asset_tag) between 2 and 40),
  name text not null check (length(name) between 2 and 120),
  type text not null default 'laptop'
    check (type in ('laptop','desktop','monitor','phone','tablet','peripheral','network','software_license','other')),
  manufacturer text,
  model text,
  serial_number text,
  status text not null default 'in_stock' check (status in ('in_stock','assigned','in_repair','retired','lost')),
  assigned_to uuid references public.employees(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  purchase_date date,
  purchase_cost numeric(12,2) check (purchase_cost is null or purchase_cost >= 0),
  vendor text,
  warranty_until date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on servicedesk.assets (assigned_to);
create index on servicedesk.assets (status);

create table servicedesk.asset_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references servicedesk.assets(id) on delete cascade,
  actor_id uuid references public.employees(id) on delete set null,
  kind text not null,
  details text,
  created_at timestamptz not null default now()
);
create index on servicedesk.asset_events (asset_id, created_at desc);

-- ===========================================================================
-- Service catalog
-- ===========================================================================
create table servicedesk.catalog_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references servicedesk.teams(id) on delete cascade,
  category_id uuid references servicedesk.categories(id) on delete set null,
  name text not null check (length(name) between 2 and 80),
  description text,
  icon text not null default 'package',
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  approval text not null default 'none' check (approval in ('none','manager','team_lead')),
  default_priority text not null default 'medium' check (default_priority in ('low','medium','high','urgent')),
  expected_days int check (expected_days is null or expected_days between 0 and 365),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- Tickets
-- ===========================================================================
create table servicedesk.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1001) unique,
  team_id uuid not null references servicedesk.teams(id),
  category_id uuid references servicedesk.categories(id) on delete set null,
  catalog_item_id uuid references servicedesk.catalog_items(id) on delete set null,
  requester_id uuid not null references public.employees(id),
  created_by uuid references public.employees(id) on delete set null,
  assignee_id uuid references public.employees(id) on delete set null,
  asset_id uuid references servicedesk.assets(id) on delete set null,
  type text not null default 'incident' check (type in ('incident','request')),
  subject text not null check (length(subject) between 3 and 200),
  description text not null check (length(description) between 1 and 20000),
  form_data jsonb,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'new' check (status in ('new','open','pending','resolved','closed')),
  source text not null default 'portal' check (source in ('portal','catalog','agent','migrated')),
  approval_status text not null default 'not_required' check (approval_status in ('not_required','pending','approved','rejected')),
  approved_at timestamptz,
  first_response_due timestamptz,
  resolution_due timestamptz,
  first_responded_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  pending_since timestamptz,
  sla_paused_minutes int not null default 0,
  response_breached boolean not null default false,
  resolution_breached boolean not null default false,
  response_warned boolean not null default false,
  resolution_warned boolean not null default false,
  csat_rating text check (csat_rating in ('good','bad')),
  csat_comment text check (csat_comment is null or length(csat_comment) <= 1000),
  csat_at timestamptz,
  legacy_id uuid unique,
  legacy_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on servicedesk.tickets (team_id, status);
create index on servicedesk.tickets (requester_id, created_at desc);
create index on servicedesk.tickets (assignee_id) where status in ('new','open','pending');
create index on servicedesk.tickets (asset_id);
create index on servicedesk.tickets (created_at);

create table servicedesk.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references servicedesk.tickets(id) on delete cascade,
  author_id uuid references public.employees(id) on delete set null,
  body text not null check (length(body) between 1 and 20000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index on servicedesk.ticket_messages (ticket_id, created_at);

create table servicedesk.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references servicedesk.tickets(id) on delete cascade,
  actor_id uuid references public.employees(id) on delete set null,
  kind text not null,
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);
create index on servicedesk.ticket_events (ticket_id, created_at);

create table servicedesk.attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references servicedesk.tickets(id) on delete cascade,
  message_id uuid references servicedesk.ticket_messages(id) on delete cascade,
  path text not null unique,
  name text not null,
  size bigint not null check (size between 1 and 10485760),
  mime text,
  uploaded_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on servicedesk.attachments (ticket_id);

create table servicedesk.approvals (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references servicedesk.tickets(id) on delete cascade,
  kind text not null check (kind in ('manager','team_lead')),
  approver_id uuid references public.employees(id) on delete set null,
  team_id uuid references servicedesk.teams(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  comment text check (comment is null or length(comment) <= 1000),
  decided_by uuid references public.employees(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (approver_id is not null or team_id is not null)
);
create index on servicedesk.approvals (ticket_id);
create index on servicedesk.approvals (approver_id) where status = 'pending';

-- ===========================================================================
-- Knowledge base
-- ===========================================================================
create or replace function servicedesk.immutable_array_to_string(text[])
returns text language sql immutable parallel safe as $$ select array_to_string($1, ' ') $$;

create table servicedesk.kb_articles (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references servicedesk.teams(id) on delete cascade,
  category_id uuid references servicedesk.categories(id) on delete set null,
  title text not null check (length(title) between 3 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  summary text check (summary is null or length(summary) <= 300),
  body text not null default '' check (length(body) <= 100000),
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  visibility text not null default 'everyone' check (visibility in ('everyone','agents')),
  author_id uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  view_count int not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', servicedesk.immutable_array_to_string(tags)), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'C')
  ) stored
);
create index on servicedesk.kb_articles using gin (search);
create index on servicedesk.kb_articles (team_id, status);

create table servicedesk.kb_feedback (
  article_id uuid not null references servicedesk.kb_articles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  primary key (article_id, employee_id)
);

-- ===========================================================================
-- Notifications (desk bell). Requester/approver-facing ones are mirrored into
-- public.notifications so they also show up in People Success.
-- ===========================================================================
create table servicedesk.notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  title text not null,
  body text,
  link text,
  ticket_id uuid references servicedesk.tickets(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on servicedesk.notifications (employee_id, created_at desc);

create or replace function servicedesk.notify(p_emp uuid, p_title text, p_body text, p_link text, p_ticket uuid, p_mirror boolean default false)
returns void language plpgsql security definer set search_path = servicedesk, public as $$
declare
  base text;
begin
  if p_emp is null or p_emp = servicedesk.me() then return; end if;
  insert into servicedesk.notifications (employee_id, title, body, link, ticket_id) values (p_emp, p_title, p_body, p_link, p_ticket);
  if p_mirror then
    select value #>> '{}' into base from servicedesk.settings where key = 'app_url';
    if coalesce(base, '') <> '' then
      insert into public.notifications (employee_id, title, body, link) values (p_emp, p_title, p_body, rtrim(base, '/') || p_link);
    end if;
  end if;
end $$;

create or replace function servicedesk.notify_leads(p_team uuid, p_title text, p_body text, p_link text, p_ticket uuid)
returns void language plpgsql security definer set search_path = servicedesk, public as $$
declare r record;
begin
  for r in select m.employee_id from servicedesk.team_members m join public.employees e on e.id = m.employee_id
           where m.team_id = p_team and m.role = 'lead' and e.status <> 'exited' loop
    perform servicedesk.notify(r.employee_id, p_title, p_body, p_link, p_ticket);
  end loop;
end $$;

-- ===========================================================================
-- Ticket helpers
-- ===========================================================================
create or replace function servicedesk.ref(p_number bigint)
returns text language sql immutable as $$ select 'SD-' || p_number $$;

create or replace function servicedesk.system_mode()
returns boolean language sql stable as $$ select coalesce(current_setting('servicedesk.system', true), '') = 'on' $$;

create or replace function servicedesk.is_approver_for(p_ticket uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select exists (
    select 1 from servicedesk.approvals a
    where a.ticket_id = p_ticket
      and (a.approver_id = servicedesk.me() or (a.team_id is not null and servicedesk.is_lead(a.team_id)))
  )
$$;

create or replace function servicedesk.is_ticket_agent(p_ticket uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select exists (select 1 from servicedesk.tickets t where t.id = p_ticket and servicedesk.is_agent(t.team_id))
$$;

create or replace function servicedesk.is_ticket_requester(p_ticket uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select exists (select 1 from servicedesk.tickets t where t.id = p_ticket and t.requester_id = servicedesk.me())
$$;

create or replace function servicedesk.can_view_ticket(p_ticket uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select servicedesk.is_ticket_requester(p_ticket) or servicedesk.is_ticket_agent(p_ticket) or servicedesk.is_approver_for(p_ticket)
$$;

-- Team agent with the fewest open tickets (ties: longest-standing member first).
create or replace function servicedesk.pick_assignee(p_team uuid)
returns uuid language sql stable security definer set search_path = servicedesk, public as $$
  select m.employee_id
  from servicedesk.team_members m
  join public.employees e on e.id = m.employee_id and e.status <> 'exited'
  left join servicedesk.tickets t on t.assignee_id = m.employee_id and t.status in ('new','open','pending')
  where m.team_id = p_team
  group by m.employee_id, m.created_at
  order by count(t.id), m.created_at
  limit 1
$$;

create or replace function servicedesk.compute_sla(t servicedesk.tickets)
returns servicedesk.tickets language plpgsql stable security definer set search_path = servicedesk, public as $$
declare
  pol servicedesk.sla_policies;
  started timestamptz;
begin
  if t.source = 'migrated' or t.approval_status in ('pending','rejected') then
    t.first_response_due := null;
    t.resolution_due := null;
    return t;
  end if;
  select * into pol from servicedesk.sla_policies where team_id = t.team_id and priority = t.priority;
  if not found then
    t.first_response_due := null;
    t.resolution_due := null;
    return t;
  end if;
  started := coalesce(t.approved_at, t.created_at, now());
  t.first_response_due := servicedesk.add_business_minutes(started, pol.first_response_mins + t.sla_paused_minutes);
  t.resolution_due := servicedesk.add_business_minutes(started, pol.resolution_mins + t.sla_paused_minutes);
  return t;
end $$;

create or replace function servicedesk.employee_name(p_emp uuid)
returns text language sql stable security definer set search_path = public as $$
  select full_name from public.employees where id = p_emp
$$;

-- ===========================================================================
-- Ticket triggers
-- ===========================================================================
create or replace function servicedesk.tickets_before_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  me uuid := servicedesk.me();
  user_ctx boolean := auth.uid() is not null and not servicedesk.system_mode();
  agent boolean;
  item servicedesk.catalog_items;
  tm servicedesk.teams;
begin
  if new.catalog_item_id is not null then
    select * into item from servicedesk.catalog_items where id = new.catalog_item_id;
    if not found then raise exception 'That service is no longer available'; end if;
    new.team_id := item.team_id;
    new.type := 'request';
    new.category_id := coalesce(new.category_id, item.category_id);
    new.approval_status := case when item.approval = 'none' then 'not_required' else 'pending' end;
  else
    new.approval_status := case when new.approval_status in ('pending','approved','rejected') and not user_ctx then new.approval_status else 'not_required' end;
  end if;

  select * into tm from servicedesk.teams where id = new.team_id;
  if not found or (not tm.active and user_ctx) then raise exception 'That team is not accepting tickets'; end if;

  agent := servicedesk.is_agent(new.team_id);
  if user_ctx then
    if me is null then raise exception 'Your account is not linked to an active employee'; end if;
    if not agent then
      if new.requester_id is distinct from me then raise exception 'You can only raise tickets for yourself'; end if;
      if item.id is not null and not item.active then raise exception 'That service is no longer available'; end if;
      if new.asset_id is not null and not exists (select 1 from servicedesk.assets a where a.id = new.asset_id and a.assigned_to = me) then
        raise exception 'You can only link assets assigned to you';
      end if;
      new.status := 'new';
      new.assignee_id := null;
      new.source := case when new.catalog_item_id is not null then 'catalog' else 'portal' end;
    else
      new.source := case when new.requester_id = me and new.catalog_item_id is not null then 'catalog'
                         when new.requester_id = me then 'portal' else 'agent' end;
      if new.status not in ('new','open') then new.status := 'new'; end if;
    end if;
    new.created_by := me;
    new.first_responded_at := null;
    new.resolved_at := null;
    new.closed_at := null;
    new.approved_at := null;
    new.pending_since := null;
    new.sla_paused_minutes := 0;
    new.response_breached := false;
    new.resolution_breached := false;
    new.response_warned := false;
    new.resolution_warned := false;
    new.csat_rating := null;
    new.csat_comment := null;
    new.csat_at := null;
    new.legacy_id := null;
    new.legacy_ref := null;
    new.created_at := now();
  end if;

  if new.category_id is not null and not exists (
    select 1 from servicedesk.categories c where c.id = new.category_id and c.team_id = new.team_id
  ) then
    raise exception 'That category belongs to another team';
  end if;

  if new.assignee_id is not null and not exists (
    select 1 from servicedesk.team_members m where m.team_id = new.team_id and m.employee_id = new.assignee_id
  ) then
    raise exception 'The assignee is not on this team';
  end if;

  if new.assignee_id is null and tm.auto_assign and new.approval_status <> 'pending' and new.source <> 'migrated' then
    new.assignee_id := servicedesk.pick_assignee(new.team_id);
  end if;
  if new.status = 'new' and new.assignee_id is not null then new.status := 'open'; end if;

  new := servicedesk.compute_sla(new);
  new.updated_at := now();
  return new;
end $$;

create or replace function servicedesk.tickets_after_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  item servicedesk.catalog_items;
  mgr uuid;
  kind text;
  link text := '/desk/tickets/' || new.number;
  ref text := servicedesk.ref(new.number);
begin
  insert into servicedesk.ticket_events (ticket_id, actor_id, kind, to_value)
  values (new.id, coalesce(servicedesk.me(), new.created_by), 'created', case when new.source = 'migrated' then 'Imported from HR Helpdesk' else null end);

  if new.source = 'migrated' then return new; end if;

  if new.created_by is distinct from new.requester_id then
    perform servicedesk.notify(new.requester_id, ref || ' raised for you', new.subject, '/requests/' || new.number, new.id, true);
  end if;

  if new.assignee_id is not null then
    perform servicedesk.notify(new.assignee_id, 'Assigned to you: ' || ref, new.subject, link, new.id);
  elsif new.priority in ('urgent','high') and new.approval_status <> 'pending' then
    perform servicedesk.notify_leads(new.team_id, 'New ' || new.priority || ' ticket ' || ref, new.subject, link, new.id);
  end if;

  if new.approval_status = 'pending' then
    select * into item from servicedesk.catalog_items where id = new.catalog_item_id;
    kind := coalesce(item.approval, 'team_lead');
    if kind = 'manager' then
      select manager_id into mgr from public.employees where id = new.requester_id;
      if mgr is null or mgr = new.requester_id then kind := 'team_lead'; end if;
    end if;
    if kind = 'manager' then
      insert into servicedesk.approvals (ticket_id, kind, approver_id) values (new.id, 'manager', mgr);
      perform servicedesk.notify(mgr, 'Approval needed: ' || ref,
        servicedesk.employee_name(new.requester_id) || ' requested “' || new.subject || '”', '/approvals', new.id, true);
    else
      insert into servicedesk.approvals (ticket_id, kind, team_id) values (new.id, 'team_lead', new.team_id);
      perform servicedesk.notify_leads(new.team_id, 'Approval needed: ' || ref,
        servicedesk.employee_name(new.requester_id) || ' requested “' || new.subject || '”', '/approvals', new.id);
    end if;
  end if;
  return new;
end $$;

create or replace function servicedesk.tickets_before_update()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  me uuid := servicedesk.me();
  user_ctx boolean := auth.uid() is not null and not servicedesk.system_mode();
  agent boolean;
  allowed servicedesk.tickets;
  close_days int := coalesce((select (value #>> '{}')::int from servicedesk.settings where key = 'auto_close_days'), 7);
  recompute boolean := false;
begin
  if new.id <> old.id or new.number <> old.number or new.created_at <> old.created_at then
    raise exception 'Ticket identity cannot change';
  end if;

  if user_ctx then
    agent := servicedesk.is_agent(old.team_id);
    if not agent then
      if old.requester_id is distinct from me then raise exception 'You cannot change this ticket'; end if;
      -- Requesters may only change status (limited transitions) and the satisfaction rating.
      allowed := old;
      allowed.status := new.status;
      allowed.csat_rating := new.csat_rating;
      allowed.csat_comment := new.csat_comment;
      allowed.csat_at := new.csat_at;
      allowed.updated_at := new.updated_at;
      if row(allowed.*) is distinct from row(new.*) then raise exception 'You cannot change these ticket details'; end if;
      if new.status is distinct from old.status then
        if not (
          (old.status = 'resolved' and new.status = 'open' and old.resolved_at > now() - make_interval(days => close_days))
          or (old.status in ('new','open','pending') and new.status = 'closed')
          or (old.status = 'pending' and new.status = 'open')
        ) then
          raise exception 'You cannot move this ticket from % to %', old.status, new.status;
        end if;
      end if;
      if new.csat_rating is distinct from old.csat_rating or new.csat_comment is distinct from old.csat_comment then
        if old.status not in ('resolved','closed') or old.csat_rating is not null then
          raise exception 'You can rate a ticket once, after it is resolved';
        end if;
        new.csat_at := now();
      end if;
    else
      if new.legacy_id is distinct from old.legacy_id or new.legacy_ref is distinct from old.legacy_ref
         or new.source is distinct from old.source or new.created_by is distinct from old.created_by then
        raise exception 'These ticket fields are read-only';
      end if;
      if new.csat_rating is distinct from old.csat_rating or new.csat_comment is distinct from old.csat_comment then
        raise exception 'Only the requester can rate a ticket';
      end if;
      if new.approval_status is distinct from old.approval_status or new.approved_at is distinct from old.approved_at then
        raise exception 'Use the approval screen to approve or reject';
      end if;
      if new.approval_status = 'pending' and new.status <> old.status then
        raise exception 'This request is waiting for approval';
      end if;
      -- Derived SLA fields are owned by the database.
      new.first_response_due := old.first_response_due;
      new.resolution_due := old.resolution_due;
      new.first_responded_at := old.first_responded_at;
      new.response_breached := old.response_breached;
      new.resolution_breached := old.resolution_breached;
      new.response_warned := old.response_warned;
      new.resolution_warned := old.resolution_warned;
      new.sla_paused_minutes := old.sla_paused_minutes;
      new.pending_since := old.pending_since;
      new.resolved_at := old.resolved_at;
      new.closed_at := old.closed_at;
    end if;
  end if;

  -- Transfers: drop a category / assignee that doesn't belong to the new team.
  if new.team_id is distinct from old.team_id then
    if new.category_id is not null and not exists (select 1 from servicedesk.categories c where c.id = new.category_id and c.team_id = new.team_id) then
      new.category_id := null;
    end if;
    if new.assignee_id is not null and not exists (select 1 from servicedesk.team_members m where m.team_id = new.team_id and m.employee_id = new.assignee_id) then
      new.assignee_id := null;
    end if;
    recompute := true;
  else
    if new.category_id is distinct from old.category_id and new.category_id is not null
       and not exists (select 1 from servicedesk.categories c where c.id = new.category_id and c.team_id = new.team_id) then
      raise exception 'That category belongs to another team';
    end if;
    if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null
       and not exists (select 1 from servicedesk.team_members m where m.team_id = new.team_id and m.employee_id = new.assignee_id) then
      raise exception 'The assignee is not on this team';
    end if;
  end if;

  if new.status = 'new' and new.assignee_id is not null and new.approval_status <> 'pending' then new.status := 'open'; end if;

  -- Status side effects.
  if new.status is distinct from old.status then
    if old.status = 'pending' and old.pending_since is not null then
      new.sla_paused_minutes := old.sla_paused_minutes + servicedesk.business_minutes_between(old.pending_since, now());
      new.pending_since := null;
      recompute := true;
    end if;
    if new.status = 'pending' then new.pending_since := now(); end if;
    if new.status = 'resolved' then
      new.resolved_at := now();
      new.resolution_breached := old.resolution_breached or (old.resolution_due is not null and now() > old.resolution_due);
    elsif old.status = 'resolved' and new.status in ('new','open','pending') then
      new.resolved_at := null;
    end if;
    if new.status = 'closed' then
      new.closed_at := now();
    elsif old.status = 'closed' then
      new.closed_at := null;
    end if;
  end if;

  if new.priority is distinct from old.priority or new.approved_at is distinct from old.approved_at then recompute := true; end if;
  if recompute and new.status not in ('resolved','closed') then
    new := servicedesk.compute_sla(new);
  end if;

  new.updated_at := now();
  return new;
end $$;

create or replace function servicedesk.tickets_after_update()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  actor uuid := servicedesk.me();
  ref text := servicedesk.ref(new.number);
  link text := '/desk/tickets/' || new.number;
  rlink text := '/requests/' || new.number;
  ev text;
begin
  if new.status is distinct from old.status then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value, to_value) values (new.id, actor, 'status', old.status, new.status);
    if new.status = 'resolved' then
      perform servicedesk.notify(new.requester_id, ref || ' was resolved', 'Let us know if it''s fixed. You can reopen it within a week.', rlink, new.id, true);
    elsif new.status = 'pending' then
      perform servicedesk.notify(new.requester_id, ref || ' needs your reply', new.subject, rlink, new.id, true);
    elsif old.status = 'resolved' and new.status = 'open' and actor = new.requester_id then
      if new.assignee_id is not null then
        perform servicedesk.notify(new.assignee_id, ref || ' was reopened', new.subject, link, new.id);
      else
        perform servicedesk.notify_leads(new.team_id, ref || ' was reopened', new.subject, link, new.id);
      end if;
    elsif new.status = 'closed' and actor = new.requester_id and new.assignee_id is not null then
      perform servicedesk.notify(new.assignee_id, ref || ' was closed by the requester', new.subject, link, new.id);
    end if;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value, to_value)
    values (new.id, actor, 'assignee', servicedesk.employee_name(old.assignee_id), servicedesk.employee_name(new.assignee_id));
    if new.assignee_id is not null then
      perform servicedesk.notify(new.assignee_id, 'Assigned to you: ' || ref, new.subject, link, new.id);
    end if;
  end if;

  if new.priority is distinct from old.priority then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value, to_value) values (new.id, actor, 'priority', old.priority, new.priority);
  end if;

  if new.team_id is distinct from old.team_id then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value, to_value)
    values (new.id, actor, 'team', (select name from servicedesk.teams where id = old.team_id), (select name from servicedesk.teams where id = new.team_id));
    if new.assignee_id is null then
      perform servicedesk.notify_leads(new.team_id, ref || ' was transferred to your team', new.subject, link, new.id);
    end if;
  end if;

  if new.category_id is distinct from old.category_id then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value, to_value)
    values (new.id, actor, 'category', (select name from servicedesk.categories where id = old.category_id), (select name from servicedesk.categories where id = new.category_id));
  end if;

  if new.approval_status is distinct from old.approval_status then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value, to_value) values (new.id, actor, 'approval', old.approval_status, new.approval_status);
  end if;

  if new.csat_rating is distinct from old.csat_rating and new.csat_rating is not null then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, to_value) values (new.id, actor, 'csat', new.csat_rating);
    if new.assignee_id is not null then
      ev := case when new.csat_rating = 'good' then 'Requester was happy with ' else 'Requester was not happy with ' end;
      perform servicedesk.notify(new.assignee_id, ev || ref, coalesce(new.csat_comment, new.subject), link, new.id);
    end if;
  end if;

  if new.asset_id is distinct from old.asset_id then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value, to_value)
    values (new.id, actor, 'asset', (select asset_tag from servicedesk.assets where id = old.asset_id), (select asset_tag from servicedesk.assets where id = new.asset_id));
  end if;
  return new;
end $$;

create trigger tickets_before_insert before insert on servicedesk.tickets for each row execute function servicedesk.tickets_before_insert();
create trigger tickets_after_insert after insert on servicedesk.tickets for each row execute function servicedesk.tickets_after_insert();
create trigger tickets_before_update before update on servicedesk.tickets for each row execute function servicedesk.tickets_before_update();
create trigger tickets_after_update after update on servicedesk.tickets for each row execute function servicedesk.tickets_after_update();

-- Messages: first-response stamp, requester reply reopens a pending ticket, notifications.
create or replace function servicedesk.messages_before_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  t servicedesk.tickets;
begin
  select * into t from servicedesk.tickets where id = new.ticket_id;
  if auth.uid() is not null and not servicedesk.system_mode() then
    new.author_id := servicedesk.me();
    new.created_at := now();
    if new.internal and not servicedesk.is_agent(t.team_id) then raise exception 'Only agents can add internal notes'; end if;
    if t.status = 'closed' and not servicedesk.is_agent(t.team_id) then
      raise exception 'This ticket is closed. Raise a new request if you still need help.';
    end if;
  end if;
  return new;
end $$;

create or replace function servicedesk.messages_after_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  t servicedesk.tickets;
  ref text;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
begin
  select * into t from servicedesk.tickets where id = new.ticket_id;
  ref := servicedesk.ref(t.number);
  if t.source = 'migrated' and prev = 'on' then return new; end if;
  perform set_config('servicedesk.system', 'on', true);

  if not new.internal and new.author_id is distinct from t.requester_id and t.first_responded_at is null and t.source <> 'migrated' then
    update servicedesk.tickets
       set first_responded_at = now(),
           response_breached = response_breached or (first_response_due is not null and now() > first_response_due)
     where id = t.id;
  end if;

  if new.author_id = t.requester_id and t.status = 'pending' then
    update servicedesk.tickets set status = 'open' where id = t.id;
  else
    update servicedesk.tickets set updated_at = now() where id = t.id;
  end if;

  perform set_config('servicedesk.system', prev, true);

  if new.internal then
    if t.assignee_id is distinct from new.author_id then
      perform servicedesk.notify(t.assignee_id, 'Internal note on ' || ref, left(new.body, 140), '/desk/tickets/' || t.number, t.id);
    end if;
  elsif new.author_id = t.requester_id then
    if t.assignee_id is not null then
      perform servicedesk.notify(t.assignee_id, 'New reply on ' || ref, left(new.body, 140), '/desk/tickets/' || t.number, t.id);
    else
      perform servicedesk.notify_leads(t.team_id, 'New reply on ' || ref, left(new.body, 140), '/desk/tickets/' || t.number, t.id);
    end if;
  else
    perform servicedesk.notify(t.requester_id, 'Update on ' || ref, left(new.body, 140), '/requests/' || t.number, t.id, true);
  end if;
  return new;
end $$;

create trigger messages_before_insert before insert on servicedesk.ticket_messages for each row execute function servicedesk.messages_before_insert();
create trigger messages_after_insert after insert on servicedesk.ticket_messages for each row execute function servicedesk.messages_after_insert();

-- ===========================================================================
-- Approvals (decided only through decide_approval)
-- ===========================================================================
create or replace function servicedesk.decide_approval(p_id uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = servicedesk, public as $$
declare
  a servicedesk.approvals;
  t servicedesk.tickets;
  me uuid := servicedesk.me();
  ref text;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into a from servicedesk.approvals where id = p_id for update;
  if not found then raise exception 'Approval not found'; end if;
  if a.status <> 'pending' then raise exception 'This request was already %', a.status; end if;
  if not (a.approver_id = me or (a.team_id is not null and servicedesk.is_lead(a.team_id))) then
    raise exception 'You are not an approver for this request';
  end if;
  select * into t from servicedesk.tickets where id = a.ticket_id;
  if t.requester_id = me and not servicedesk.is_admin() then raise exception 'You cannot approve your own request'; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Add a reason for rejecting'; end if;

  update servicedesk.approvals
     set status = case when p_approve then 'approved' else 'rejected' end,
         comment = nullif(trim(p_comment), ''), decided_by = me, decided_at = now()
   where id = a.id;

  ref := servicedesk.ref(t.number);
  perform set_config('servicedesk.system', 'on', true);
  if p_approve then
    update servicedesk.tickets
       set approval_status = 'approved', approved_at = now(),
           assignee_id = coalesce(assignee_id, case when (select auto_assign from servicedesk.teams where id = t.team_id) then servicedesk.pick_assignee(t.team_id) end)
     where id = t.id;
  else
    update servicedesk.tickets set approval_status = 'rejected', status = 'closed' where id = t.id;
  end if;
  perform set_config('servicedesk.system', prev, true);

  perform servicedesk.notify(t.requester_id,
    ref || case when p_approve then ' was approved' else ' was rejected' end,
    coalesce(nullif(trim(p_comment), ''), t.subject), '/requests/' || t.number, t.id, true);
  if p_approve then
    perform servicedesk.notify_leads(t.team_id, 'Approved request ' || ref || ' is ready', t.subject, '/desk/tickets/' || t.number, t.id);
  end if;
end $$;

-- ===========================================================================
-- SLA checks (idempotent): breaches, at-risk warnings, auto-close.
-- ===========================================================================
create or replace function servicedesk.run_sla_checks()
returns int language plpgsql security definer set search_path = servicedesk, public as $$
declare
  t record;
  n int := 0;
  close_days int := coalesce((select (value #>> '{}')::int from servicedesk.settings where key = 'auto_close_days'), 7);
  ref text;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
begin
  perform set_config('servicedesk.system', 'on', true);

  for t in select * from servicedesk.tickets
           where status in ('new','open') and first_responded_at is null and first_response_due < now() and not response_breached loop
    update servicedesk.tickets set response_breached = true, response_warned = true where id = t.id;
    insert into servicedesk.ticket_events (ticket_id, kind, to_value) values (t.id, 'sla_breach', 'first_response');
    ref := servicedesk.ref(t.number);
    perform servicedesk.notify(t.assignee_id, 'First response overdue: ' || ref, t.subject, '/desk/tickets/' || t.number, t.id);
    perform servicedesk.notify_leads(t.team_id, 'First response overdue: ' || ref, t.subject, '/desk/tickets/' || t.number, t.id);
    n := n + 1;
  end loop;

  for t in select * from servicedesk.tickets
           where status in ('new','open') and resolution_due < now() and not resolution_breached loop
    update servicedesk.tickets set resolution_breached = true, resolution_warned = true where id = t.id;
    insert into servicedesk.ticket_events (ticket_id, kind, to_value) values (t.id, 'sla_breach', 'resolution');
    ref := servicedesk.ref(t.number);
    perform servicedesk.notify(t.assignee_id, 'Resolution overdue: ' || ref, t.subject, '/desk/tickets/' || t.number, t.id);
    perform servicedesk.notify_leads(t.team_id, 'Resolution overdue: ' || ref, t.subject, '/desk/tickets/' || t.number, t.id);
    n := n + 1;
  end loop;

  for t in select * from servicedesk.tickets
           where status in ('new','open') and first_responded_at is null and not response_warned and first_response_due > now()
             and first_response_due - now() <= greatest(interval '15 minutes', (first_response_due - coalesce(approved_at, created_at)) * 0.25) loop
    update servicedesk.tickets set response_warned = true where id = t.id;
    perform servicedesk.notify(t.assignee_id, 'First response due soon: ' || servicedesk.ref(t.number), t.subject, '/desk/tickets/' || t.number, t.id);
    if t.assignee_id is null then
      perform servicedesk.notify_leads(t.team_id, 'Unassigned ticket due soon: ' || servicedesk.ref(t.number), t.subject, '/desk/tickets/' || t.number, t.id);
    end if;
    n := n + 1;
  end loop;

  for t in select * from servicedesk.tickets
           where status in ('new','open') and not resolution_warned and resolution_due > now()
             and resolution_due - now() <= greatest(interval '30 minutes', (resolution_due - coalesce(approved_at, created_at)) * 0.25) loop
    update servicedesk.tickets set resolution_warned = true where id = t.id;
    if t.assignee_id is not null then
      perform servicedesk.notify(t.assignee_id, 'Resolution due soon: ' || servicedesk.ref(t.number), t.subject, '/desk/tickets/' || t.number, t.id);
    else
      perform servicedesk.notify_leads(t.team_id, 'Resolution due soon: ' || servicedesk.ref(t.number), t.subject, '/desk/tickets/' || t.number, t.id);
    end if;
    n := n + 1;
  end loop;

  for t in select id from servicedesk.tickets where status = 'resolved' and resolved_at < now() - make_interval(days => close_days) loop
    update servicedesk.tickets set status = 'closed' where id = t.id;
    n := n + 1;
  end loop;

  perform set_config('servicedesk.system', prev, true);
  update servicedesk.settings set value = to_jsonb(now()), updated_at = now() where key = 'sla_last_run';
  return n;
end $$;

-- Called when the agent queue loads; runs the checks at most every 2 minutes.
create or replace function servicedesk.maybe_run_sla_checks()
returns void language plpgsql security definer set search_path = servicedesk, public as $$
declare last_run timestamptz;
begin
  if not servicedesk.is_any_agent() then return; end if;
  select (value #>> '{}')::timestamptz into last_run from servicedesk.settings where key = 'sla_last_run';
  if last_run is null or last_run < now() - interval '2 minutes' then
    perform servicedesk.run_sla_checks();
  end if;
end $$;

-- ===========================================================================
-- Knowledge base helpers
-- ===========================================================================
create or replace function servicedesk.search_articles(q text, lim int default 8)
returns setof servicedesk.kb_articles language plpgsql stable set search_path = servicedesk, public as $$
declare
  tsq tsquery;
  terms text;
begin
  select string_agg(quote_literal(w) || ':*', ' & ') into terms
  from regexp_split_to_table(lower(regexp_replace(coalesce(q, ''), '[^[:alnum:] ]', ' ', 'g')), '\s+') w
  where length(w) > 1;
  if terms is null then return; end if;
  tsq := to_tsquery('english', terms);
  return query
    select a.* from servicedesk.kb_articles a
    where a.status = 'published' and a.search @@ tsq
    order by ts_rank(a.search, tsq) desc, a.view_count desc
    limit least(greatest(coalesce(lim, 8), 1), 50);
end $$;

create or replace function servicedesk.record_article_view(p_id uuid)
returns void language plpgsql security definer set search_path = servicedesk as $$
declare prev text := coalesce(current_setting('servicedesk.system', true), '');
begin
  perform set_config('servicedesk.system', 'on', true);
  update servicedesk.kb_articles set view_count = view_count + 1 where id = p_id and status = 'published';
  perform set_config('servicedesk.system', prev, true);
end $$;

create or replace function servicedesk.kb_before_write()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if tg_op = 'UPDATE' and servicedesk.system_mode() then return new; end if;
  if tg_op = 'INSERT' then
    new.author_id := coalesce(servicedesk.me(), new.author_id);
    new.view_count := 0;
    new.created_at := now();
  else
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    if not servicedesk.system_mode() and auth.uid() is not null and new.view_count <> old.view_count then
      new.view_count := old.view_count;
    end if;
  end if;
  new.updated_by := coalesce(servicedesk.me(), new.updated_by);
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then new.published_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger kb_before_write before insert or update on servicedesk.kb_articles for each row execute function servicedesk.kb_before_write();

-- ===========================================================================
-- Asset history
-- ===========================================================================
create or replace function servicedesk.assets_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.assigned_to is distinct from old.assigned_to then
      if new.assigned_to is not null then new.status := 'assigned';
      elsif new.status = 'assigned' then new.status := 'in_stock';
      end if;
    end if;
  elsif new.assigned_to is not null then
    new.status := 'assigned';
  end if;
  if new.status <> 'assigned' and new.assigned_to is not null and new.status in ('in_stock','retired','lost') then
    new.assigned_to := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function servicedesk.assets_after_write()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare actor uuid := servicedesk.me();
begin
  if tg_op = 'INSERT' then
    insert into servicedesk.asset_events (asset_id, actor_id, kind, details) values (new.id, actor, 'created', new.name);
    if new.assigned_to is not null then
      insert into servicedesk.asset_events (asset_id, actor_id, kind, details) values (new.id, actor, 'assigned', servicedesk.employee_name(new.assigned_to));
    end if;
    return new;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    if old.assigned_to is not null then
      insert into servicedesk.asset_events (asset_id, actor_id, kind, details) values (new.id, actor, 'unassigned', servicedesk.employee_name(old.assigned_to));
    end if;
    if new.assigned_to is not null then
      insert into servicedesk.asset_events (asset_id, actor_id, kind, details) values (new.id, actor, 'assigned', servicedesk.employee_name(new.assigned_to));
      perform servicedesk.notify(new.assigned_to, new.asset_tag || ' is now assigned to you', new.name, '/assets/mine', null, true);
    end if;
  end if;
  if new.status is distinct from old.status then
    insert into servicedesk.asset_events (asset_id, actor_id, kind, details) values (new.id, actor, 'status', old.status || ' → ' || new.status);
  end if;
  return new;
end $$;

create trigger assets_before_write before insert or update on servicedesk.assets for each row execute function servicedesk.assets_before_write();
create trigger assets_after_write after insert or update on servicedesk.assets for each row execute function servicedesk.assets_after_write();

create or replace function servicedesk.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger catalog_items_touch before update on servicedesk.catalog_items for each row execute function servicedesk.touch_updated_at();

-- ===========================================================================
-- People view (lets PostgREST embed employee details from desk tables)
-- ===========================================================================
create or replace view servicedesk.people with (security_invoker = true) as
select e.id, e.full_name, e.first_name, e.email, e.employee_code, e.avatar_url, e.phone, e.status, e.role,
       e.manager_id, e.location_id, e.department_id,
       d.name as department, g.title as designation, l.name as location
from public.employees e
left join public.departments d on d.id = e.department_id
left join public.designations g on g.id = e.designation_id
left join public.locations l on l.id = e.location_id;

-- ===========================================================================
-- HR helpdesk import (re-runnable; skips tickets already imported)
-- ===========================================================================
create or replace function servicedesk.import_hr_helpdesk()
returns int language plpgsql security definer set search_path = servicedesk, public as $$
declare
  hr uuid := (select id from servicedesk.teams where key = 'hr');
  it uuid := (select id from servicedesk.teams where key = 'it');
  r record;
  c record;
  new_id uuid;
  team uuid;
  cat uuid;
  n int := 0;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
begin
  if hr is null then raise exception 'HR team is missing'; end if;
  perform set_config('servicedesk.system', 'on', true);
  for r in select * from public.helpdesk_tickets h where not exists (select 1 from servicedesk.tickets t where t.legacy_id = h.id) order by h.created_at loop
    team := case when r.category = 'IT & Access' and it is not null then it else hr end;
    select id into cat from servicedesk.categories
     where team_id = team and name = case when r.category = 'IT & Access' then 'Access & Accounts' else r.category end;
    if cat is null then select id into cat from servicedesk.categories where team_id = team and name = 'Other'; end if;
    insert into servicedesk.tickets (team_id, category_id, requester_id, created_by, assignee_id, type, subject, description,
                                     priority, status, source, resolved_at, closed_at, legacy_id, legacy_ref, created_at)
    values (team, cat, r.employee_id, r.employee_id,
            case when exists (select 1 from servicedesk.team_members m where m.team_id = team and m.employee_id = r.assigned_to) then r.assigned_to end,
            'incident', left(r.subject, 200), r.description, r.priority,
            case r.status when 'in_progress' then 'open' else r.status end,
            'migrated',
            case when r.status in ('resolved','closed') then coalesce(r.resolved_at, r.updated_at) end,
            case when r.status = 'closed' then r.updated_at end,
            r.id, 'HD-' || r.seq, r.created_at)
    returning id into new_id;
    for c in select * from public.ticket_comments where ticket_id = r.id order by created_at loop
      insert into servicedesk.ticket_messages (ticket_id, author_id, body, internal, created_at) values (new_id, c.author_id, c.body, false, c.created_at);
    end loop;
    n := n + 1;
  end loop;
  perform set_config('servicedesk.system', prev, true);
  return n;
end $$;

-- ===========================================================================
-- Row-level security
-- ===========================================================================
alter table servicedesk.settings enable row level security;
alter table servicedesk.teams enable row level security;
alter table servicedesk.team_members enable row level security;
alter table servicedesk.categories enable row level security;
alter table servicedesk.sla_policies enable row level security;
alter table servicedesk.assets enable row level security;
alter table servicedesk.asset_events enable row level security;
alter table servicedesk.catalog_items enable row level security;
alter table servicedesk.tickets enable row level security;
alter table servicedesk.ticket_messages enable row level security;
alter table servicedesk.ticket_events enable row level security;
alter table servicedesk.attachments enable row level security;
alter table servicedesk.approvals enable row level security;
alter table servicedesk.kb_articles enable row level security;
alter table servicedesk.kb_feedback enable row level security;
alter table servicedesk.notifications enable row level security;

create policy settings_read on servicedesk.settings for select to authenticated using (true);
create policy settings_admin on servicedesk.settings for all to authenticated using (servicedesk.is_admin()) with check (servicedesk.is_admin());

create policy teams_read on servicedesk.teams for select to authenticated using (true);
create policy teams_admin_insert on servicedesk.teams for insert to authenticated with check (servicedesk.is_admin());
create policy teams_lead_update on servicedesk.teams for update to authenticated using (servicedesk.is_lead(id)) with check (servicedesk.is_lead(id));
create policy teams_admin_delete on servicedesk.teams for delete to authenticated using (servicedesk.is_admin());

create policy members_read on servicedesk.team_members for select to authenticated using (true);
create policy members_lead_write on servicedesk.team_members for all to authenticated using (servicedesk.is_lead(team_id)) with check (servicedesk.is_lead(team_id));

create policy categories_read on servicedesk.categories for select to authenticated using (true);
create policy categories_lead_write on servicedesk.categories for all to authenticated using (servicedesk.is_lead(team_id)) with check (servicedesk.is_lead(team_id));

create policy sla_read on servicedesk.sla_policies for select to authenticated using (true);
create policy sla_lead_write on servicedesk.sla_policies for all to authenticated using (servicedesk.is_lead(team_id)) with check (servicedesk.is_lead(team_id));

create policy catalog_read on servicedesk.catalog_items for select to authenticated using (active or servicedesk.is_agent(team_id));
create policy catalog_lead_write on servicedesk.catalog_items for all to authenticated using (servicedesk.is_lead(team_id)) with check (servicedesk.is_lead(team_id));

create policy assets_read on servicedesk.assets for select to authenticated using (assigned_to = servicedesk.me() or servicedesk.manages_assets());
create policy assets_write on servicedesk.assets for all to authenticated using (servicedesk.manages_assets()) with check (servicedesk.manages_assets());
create policy asset_events_read on servicedesk.asset_events for select to authenticated using (servicedesk.manages_assets());

create policy tickets_read on servicedesk.tickets for select to authenticated
  using (requester_id = servicedesk.me() or servicedesk.is_agent(team_id) or servicedesk.is_approver_for(id));
create policy tickets_insert on servicedesk.tickets for insert to authenticated
  with check (requester_id = servicedesk.me() or servicedesk.is_agent(team_id));
create policy tickets_update on servicedesk.tickets for update to authenticated
  using (requester_id = servicedesk.me() or servicedesk.is_agent(team_id)) with check (true);
create policy tickets_delete on servicedesk.tickets for delete to authenticated using (servicedesk.is_admin());

create policy messages_read on servicedesk.ticket_messages for select to authenticated
  using (servicedesk.can_view_ticket(ticket_id) and (not internal or servicedesk.is_ticket_agent(ticket_id)));
create policy messages_insert on servicedesk.ticket_messages for insert to authenticated
  with check (
    (servicedesk.is_ticket_requester(ticket_id) or servicedesk.is_ticket_agent(ticket_id))
    and (not internal or servicedesk.is_ticket_agent(ticket_id))
  );

create policy events_read on servicedesk.ticket_events for select to authenticated using (servicedesk.can_view_ticket(ticket_id));

create policy attachments_read on servicedesk.attachments for select to authenticated
  using (servicedesk.can_view_ticket(ticket_id) and (message_id is null or exists (select 1 from servicedesk.ticket_messages m where m.id = message_id)));
create policy attachments_insert on servicedesk.attachments for insert to authenticated
  with check (uploaded_by = servicedesk.me() and (servicedesk.is_ticket_requester(ticket_id) or servicedesk.is_ticket_agent(ticket_id)));

create policy approvals_read on servicedesk.approvals for select to authenticated
  using (approver_id = servicedesk.me() or (team_id is not null and servicedesk.is_lead(team_id)) or servicedesk.can_view_ticket(ticket_id));

create policy kb_read on servicedesk.kb_articles for select to authenticated
  using ((status = 'published' and (visibility = 'everyone' or servicedesk.is_any_agent())) or servicedesk.is_agent(team_id));
create policy kb_agent_insert on servicedesk.kb_articles for insert to authenticated with check (servicedesk.is_agent(team_id));
create policy kb_agent_update on servicedesk.kb_articles for update to authenticated using (servicedesk.is_agent(team_id)) with check (servicedesk.is_agent(team_id));
create policy kb_lead_delete on servicedesk.kb_articles for delete to authenticated using (servicedesk.is_lead(team_id));

create policy kb_feedback_read on servicedesk.kb_feedback for select to authenticated using (employee_id = servicedesk.me() or servicedesk.is_any_agent());
create policy kb_feedback_write on servicedesk.kb_feedback for all to authenticated using (employee_id = servicedesk.me()) with check (employee_id = servicedesk.me());

create policy notifications_own on servicedesk.notifications for select to authenticated using (employee_id = servicedesk.me());
create policy notifications_mark_read on servicedesk.notifications for update to authenticated using (employee_id = servicedesk.me()) with check (employee_id = servicedesk.me());
create policy notifications_delete_own on servicedesk.notifications for delete to authenticated using (employee_id = servicedesk.me());

-- ===========================================================================
-- Grants
-- ===========================================================================
grant select, insert, update, delete on all tables in schema servicedesk to authenticated;
grant all on all tables in schema servicedesk to service_role;
grant usage, select on all sequences in schema servicedesk to authenticated, service_role;

revoke execute on all functions in schema servicedesk from public, anon;
grant execute on all functions in schema servicedesk to authenticated, service_role;
-- Internal-only functions.
revoke execute on function servicedesk.notify(uuid, text, text, text, uuid, boolean) from authenticated;
revoke execute on function servicedesk.notify_leads(uuid, text, text, text, uuid) from authenticated;
revoke execute on function servicedesk.run_sla_checks() from authenticated;
revoke execute on function servicedesk.import_hr_helpdesk() from authenticated;
revoke execute on function servicedesk.compute_sla(servicedesk.tickets) from authenticated;

-- Notifications: users may only flip read_at.
revoke update on servicedesk.notifications from authenticated;
grant update (read_at) on servicedesk.notifications to authenticated;
-- Events and asset history are written by triggers only.
revoke insert, update, delete on servicedesk.ticket_events, servicedesk.asset_events, servicedesk.approvals from authenticated;

-- ===========================================================================
-- Storage bucket for attachments (private; served via signed URLs)
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('servicedesk', 'servicedesk', false, 10485760)
on conflict (id) do nothing;

-- ===========================================================================
-- Reference data: IT and HR teams, categories, SLA targets
-- ===========================================================================
insert into servicedesk.teams (key, name, description, color, icon, manages_assets, auto_assign, sort_order) values
  ('it', 'IT Support', 'Laptops, accounts, software, network and anything tech.', '#2d48c8', 'monitor', true, true, 1),
  ('hr', 'HR', 'Payroll, leave, policies, letters and people questions.', '#c2410c', 'users', false, false, 2)
on conflict (key) do nothing;

insert into servicedesk.categories (team_id, name, sort_order)
select t.id, c.name, c.ord from servicedesk.teams t
join (values
  ('it', 'Hardware', 1), ('it', 'Software', 2), ('it', 'Access & Accounts', 3), ('it', 'Network & VPN', 4),
  ('it', 'Email & Collaboration', 5), ('it', 'Other', 9),
  ('hr', 'Payroll', 1), ('hr', 'Leave & Attendance', 2), ('hr', 'Policies', 3), ('hr', 'Documents & Letters', 4), ('hr', 'Other', 9)
) as c(team, name, ord) on c.team = t.key
on conflict (team_id, name) do nothing;

insert into servicedesk.sla_policies (team_id, priority, first_response_mins, resolution_mins)
select t.id, p.priority, p.fr, p.res from servicedesk.teams t
cross join (values ('urgent', 30, 240), ('high', 60, 480), ('medium', 240, 1440), ('low', 480, 2400)) as p(priority, fr, res)
on conflict (team_id, priority) do nothing;

-- Starting members: HR admins lead the HR team; super admins lead IT.
insert into servicedesk.team_members (team_id, employee_id, role)
select t.id, e.id, 'lead' from servicedesk.teams t join public.employees e on e.status <> 'exited'
where (t.key = 'hr' and e.role = 'hr_admin') or (t.key = 'it' and e.role = 'super_admin')
on conflict do nothing;

-- ===========================================================================
-- Scheduling: pg_cron every 5 minutes when the extension is available.
-- ===========================================================================
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('servicedesk-sla-checks', '*/5 * * * *', 'select servicedesk.run_sla_checks()');
exception when others then
  raise notice 'pg_cron not available (%); SLA checks run from the app instead', sqlerrm;
end $$;

-- ===========================================================================
-- Expose the schema to the Data API (PostgREST).
-- ===========================================================================
do $$
declare cur text;
begin
  select coalesce(
    (select split_part(c, '=', 2) from pg_roles r, unnest(r.rolconfig) c where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%'),
    'public, graphql_public') into cur;
  if position('servicedesk' in cur) = 0 then
    execute format('alter role authenticator set pgrst.db_schemas = %L', cur || ', servicedesk');
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
