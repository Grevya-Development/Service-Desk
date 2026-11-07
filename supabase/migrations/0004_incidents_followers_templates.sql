-- 0004: incidents (service status), followers/CC, reply templates, agent away status,
-- merge duplicates, pending reminders + auto-resolve.

-- ---------------------------------------------------------------------------
-- New columns on tickets
-- ---------------------------------------------------------------------------
alter table servicedesk.tickets add column if not exists merged_into uuid references servicedesk.tickets(id) on delete set null;
alter table servicedesk.tickets add column if not exists pending_reminded_at timestamptz;

insert into servicedesk.settings (key, value) values
  ('pending_reminder_days', '3'),
  ('pending_auto_resolve_days', '5')
on conflict (key) do nothing;

create or replace function servicedesk.is_team_member(p_team uuid, p_emp uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select exists (select 1 from servicedesk.team_members m where m.team_id = p_team and m.employee_id = p_emp)
      or exists (select 1 from public.employees e where e.id = p_emp and e.role = 'super_admin')
$$;

-- ---------------------------------------------------------------------------
-- Agent availability (auto-assign skips agents who are away)
-- ---------------------------------------------------------------------------
create table servicedesk.agent_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  away boolean not null default false,
  away_until date,
  updated_at timestamptz not null default now()
);
alter table servicedesk.agent_profiles enable row level security;
create policy agent_profiles_read on servicedesk.agent_profiles for select to authenticated using (true);
create policy agent_profiles_own on servicedesk.agent_profiles for all to authenticated
  using (employee_id = servicedesk.me() or servicedesk.is_admin()) with check (employee_id = servicedesk.me() or servicedesk.is_admin());
create trigger agent_profiles_touch before update on servicedesk.agent_profiles for each row execute function servicedesk.touch_updated_at();

create or replace function servicedesk.is_away(p_emp uuid)
returns boolean language sql stable security definer set search_path = servicedesk as $$
  select coalesce((select away and (away_until is null or away_until >= (now() at time zone 'Asia/Kolkata')::date)
                   from servicedesk.agent_profiles where employee_id = p_emp), false)
$$;

-- ---------------------------------------------------------------------------
-- Reply templates (canned responses)
-- ---------------------------------------------------------------------------
create table servicedesk.canned_responses (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references servicedesk.teams(id) on delete cascade,
  title text not null check (length(title) between 2 and 80),
  body text not null check (length(body) between 1 and 5000),
  created_by uuid references public.employees(id) on delete set null,
  use_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on servicedesk.canned_responses (team_id);
alter table servicedesk.canned_responses enable row level security;
create policy canned_read on servicedesk.canned_responses for select to authenticated using (servicedesk.is_agent(team_id));
create policy canned_write on servicedesk.canned_responses for all to authenticated using (servicedesk.is_agent(team_id)) with check (servicedesk.is_agent(team_id));
create trigger canned_touch before update on servicedesk.canned_responses for each row execute function servicedesk.touch_updated_at();

create or replace function servicedesk.record_canned_use(p_id uuid)
returns void language sql security definer set search_path = servicedesk as $$
  update servicedesk.canned_responses set use_count = use_count + 1 where id = p_id and servicedesk.is_agent(team_id)
$$;

-- ---------------------------------------------------------------------------
-- Followers / CC: can view the ticket, reply, and get public updates
-- ---------------------------------------------------------------------------
create table servicedesk.ticket_followers (
  ticket_id uuid not null references servicedesk.tickets(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  added_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (ticket_id, employee_id)
);
create index on servicedesk.ticket_followers (employee_id);
alter table servicedesk.ticket_followers enable row level security;

create or replace function servicedesk.is_ticket_follower(p_ticket uuid)
returns boolean language sql stable security definer set search_path = servicedesk as $$
  select exists (select 1 from servicedesk.ticket_followers f where f.ticket_id = p_ticket and f.employee_id = servicedesk.me())
$$;

create or replace function servicedesk.can_view_ticket(p_ticket uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select servicedesk.is_ticket_requester(p_ticket) or servicedesk.is_ticket_agent(p_ticket)
      or servicedesk.is_approver_for(p_ticket) or servicedesk.is_ticket_follower(p_ticket)
$$;

create policy followers_read on servicedesk.ticket_followers for select to authenticated using (servicedesk.can_view_ticket(ticket_id));
create policy followers_add on servicedesk.ticket_followers for insert to authenticated
  with check (servicedesk.is_ticket_requester(ticket_id) or servicedesk.is_ticket_agent(ticket_id));
create policy followers_remove on servicedesk.ticket_followers for delete to authenticated
  using (employee_id = servicedesk.me() or servicedesk.is_ticket_requester(ticket_id) or servicedesk.is_ticket_agent(ticket_id));

create or replace function servicedesk.followers_before_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare t servicedesk.tickets;
begin
  select * into t from servicedesk.tickets where id = new.ticket_id;
  if new.employee_id = t.requester_id then raise exception 'The requester already gets every update'; end if;
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.status <> 'exited') then
    raise exception 'Choose an active employee';
  end if;
  if (select count(*) from servicedesk.ticket_followers where ticket_id = new.ticket_id) >= 20 then
    raise exception 'A ticket can have at most 20 followers';
  end if;
  new.added_by := coalesce(servicedesk.me(), new.added_by);
  new.created_at := now();
  return new;
end $$;
create trigger followers_before_insert before insert on servicedesk.ticket_followers for each row execute function servicedesk.followers_before_insert();

create or replace function servicedesk.followers_after_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare t servicedesk.tickets;
begin
  select * into t from servicedesk.tickets where id = new.ticket_id;
  insert into servicedesk.ticket_events (ticket_id, actor_id, kind, to_value) values (t.id, servicedesk.me(), 'follower', servicedesk.employee_name(new.employee_id));
  if not servicedesk.system_mode() then
    perform servicedesk.notify(new.employee_id, 'You were added to ' || servicedesk.ref(t.number),
      coalesce(servicedesk.employee_name(new.added_by), 'Someone') || ' added you to “' || t.subject || '”', '/requests/' || t.number, t.id, true);
  end if;
  return new;
end $$;
create trigger followers_after_insert after insert on servicedesk.ticket_followers for each row execute function servicedesk.followers_after_insert();

create or replace function servicedesk.notify_followers(p_ticket uuid, p_title text, p_body text, p_link text, p_skip uuid default null)
returns void language plpgsql security definer set search_path = servicedesk, public as $$
declare r record;
begin
  for r in select f.employee_id from servicedesk.ticket_followers f join public.employees e on e.id = f.employee_id
           where f.ticket_id = p_ticket and e.status <> 'exited' and f.employee_id is distinct from p_skip loop
    perform servicedesk.notify(r.employee_id, p_title, p_body, p_link, p_ticket, true);
  end loop;
end $$;

-- Tickets and messages visible to / writable by followers.
drop policy tickets_read on servicedesk.tickets;
create policy tickets_read on servicedesk.tickets for select to authenticated
  using (requester_id = servicedesk.me() or servicedesk.is_agent(team_id) or servicedesk.is_approver_for(id) or servicedesk.is_ticket_follower(id));

drop policy messages_insert on servicedesk.ticket_messages;
create policy messages_insert on servicedesk.ticket_messages for insert to authenticated
  with check (
    (servicedesk.is_ticket_requester(ticket_id) or servicedesk.is_ticket_agent(ticket_id) or servicedesk.is_ticket_follower(ticket_id))
    and (not internal or servicedesk.is_ticket_agent(ticket_id))
  );

-- ---------------------------------------------------------------------------
-- Incidents (service status)
-- ---------------------------------------------------------------------------
create table servicedesk.incidents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references servicedesk.teams(id) on delete cascade,
  title text not null check (length(title) between 3 and 120),
  summary text not null check (length(summary) between 3 and 2000),
  status text not null default 'investigating' check (status in ('investigating','identified','monitoring','resolved')),
  severity text not null default 'major' check (severity in ('major','minor')),
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on servicedesk.incidents (status);
alter table servicedesk.tickets add column if not exists incident_id uuid references servicedesk.incidents(id) on delete set null;
create index on servicedesk.tickets (incident_id);

create table servicedesk.incident_updates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references servicedesk.incidents(id) on delete cascade,
  status text not null check (status in ('investigating','identified','monitoring','resolved')),
  body text not null check (length(body) between 1 and 2000),
  author_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on servicedesk.incident_updates (incident_id, created_at);

create table servicedesk.incident_subscribers (
  incident_id uuid not null references servicedesk.incidents(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (incident_id, employee_id)
);

alter table servicedesk.incidents enable row level security;
alter table servicedesk.incident_updates enable row level security;
alter table servicedesk.incident_subscribers enable row level security;
create policy incidents_read on servicedesk.incidents for select to authenticated using (true);
create policy incidents_insert on servicedesk.incidents for insert to authenticated with check (servicedesk.is_agent(team_id));
create policy incidents_update on servicedesk.incidents for update to authenticated using (servicedesk.is_agent(team_id)) with check (servicedesk.is_agent(team_id));
create policy incidents_delete on servicedesk.incidents for delete to authenticated using (servicedesk.is_lead(team_id));
create policy incident_updates_read on servicedesk.incident_updates for select to authenticated using (true);
create policy incident_updates_insert on servicedesk.incident_updates for insert to authenticated
  with check (exists (select 1 from servicedesk.incidents i where i.id = incident_id and servicedesk.is_agent(i.team_id)));
create policy incident_subs_read on servicedesk.incident_subscribers for select to authenticated using (employee_id = servicedesk.me() or servicedesk.is_any_agent());
create policy incident_subs_own on servicedesk.incident_subscribers for all to authenticated
  using (employee_id = servicedesk.me()) with check (employee_id = servicedesk.me());

create or replace function servicedesk.incidents_before_write()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(servicedesk.me(), new.created_by);
    new.created_at := now();
    new.started_at := coalesce(new.started_at, now());
  end if;
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status <> 'resolved') then new.resolved_at := now(); end if;
  if new.status <> 'resolved' then new.resolved_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger incidents_before_write before insert or update on servicedesk.incidents for each row execute function servicedesk.incidents_before_write();

create or replace function servicedesk.incidents_after_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  insert into servicedesk.incident_updates (incident_id, status, body, author_id) values (new.id, new.status, new.summary, new.created_by);
  perform servicedesk.notify_leads(new.team_id, 'Incident opened: ' || new.title, new.summary, '/status', null);
  return new;
end $$;
create trigger incidents_after_insert after insert on servicedesk.incidents for each row execute function servicedesk.incidents_after_insert();

-- An update moves the incident's status and tells everyone affected.
create or replace function servicedesk.incident_updates_after_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  i servicedesk.incidents;
  r record;
  title text;
begin
  select * into i from servicedesk.incidents where id = new.incident_id;
  if i.status is distinct from new.status then
    update servicedesk.incidents set status = new.status where id = i.id;
  end if;
  if new.author_id is not distinct from i.created_by and new.body = i.summary and new.created_at - i.created_at < interval '5 seconds' then
    return new; -- the opening update; nobody is subscribed yet
  end if;
  title := case when new.status = 'resolved' then 'Fixed: ' else 'Update: ' end || i.title;
  for r in
    select distinct emp from (
      select s.employee_id as emp from servicedesk.incident_subscribers s where s.incident_id = i.id
      union
      select t.requester_id from servicedesk.tickets t where t.incident_id = i.id and t.status in ('new','open','pending')
    ) x
  loop
    perform servicedesk.notify(r.emp, title, left(new.body, 200), '/status', null, true);
  end loop;
  return new;
end $$;
create trigger incident_updates_after_insert after insert on servicedesk.incident_updates for each row execute function servicedesk.incident_updates_after_insert();

-- Resolve an incident and (optionally) every open ticket linked to it, in one step.
create or replace function servicedesk.resolve_incident(p_id uuid, p_message text, p_resolve_tickets boolean default true)
returns int language plpgsql security definer set search_path = servicedesk, public as $$
declare
  i servicedesk.incidents;
  t record;
  n int := 0;
  me uuid := servicedesk.me();
  prev text := coalesce(current_setting('servicedesk.system', true), '');
begin
  select * into i from servicedesk.incidents where id = p_id;
  if not found then raise exception 'Incident not found'; end if;
  if not servicedesk.is_agent(i.team_id) then raise exception 'Only agents of this team can resolve it'; end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'Tell people what was fixed'; end if;
  insert into servicedesk.incident_updates (incident_id, status, body, author_id) values (i.id, 'resolved', trim(p_message), me);
  if p_resolve_tickets then
    perform set_config('servicedesk.system', 'on', true);
    for t in select id from servicedesk.tickets where incident_id = i.id and status in ('new','open','pending') loop
      insert into servicedesk.ticket_messages (ticket_id, author_id, body, internal)
      values (t.id, me, 'Fixed as part of incident “' || i.title || '”: ' || trim(p_message), false);
      update servicedesk.tickets set status = 'resolved' where id = t.id;
      n := n + 1;
    end loop;
    perform set_config('servicedesk.system', prev, true);
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Merge a duplicate ticket into another
-- ---------------------------------------------------------------------------
create or replace function servicedesk.merge_tickets(p_source uuid, p_target uuid)
returns void language plpgsql security definer set search_path = servicedesk, public as $$
declare
  s servicedesk.tickets;
  t servicedesk.tickets;
  me uuid := servicedesk.me();
  prev text := coalesce(current_setting('servicedesk.system', true), '');
begin
  if p_source = p_target then raise exception 'Choose a different ticket to merge into'; end if;
  select * into s from servicedesk.tickets where id = p_source;
  select * into t from servicedesk.tickets where id = p_target;
  if s.id is null or t.id is null then raise exception 'Ticket not found'; end if;
  if not servicedesk.is_agent(s.team_id) or not servicedesk.is_agent(t.team_id) then raise exception 'You need to be an agent of both teams'; end if;
  if s.merged_into is not null then raise exception 'This ticket was already merged'; end if;
  if t.status = 'closed' then raise exception 'You can''t merge into a closed ticket'; end if;

  perform set_config('servicedesk.system', 'on', true);
  insert into servicedesk.ticket_messages (ticket_id, author_id, body, internal)
  values (s.id, me, 'This request was merged into ' || servicedesk.ref(t.number) || ' (“' || t.subject || '”). Follow updates there — you''ve been added to it.', false);
  update servicedesk.tickets set merged_into = t.id, status = 'closed' where id = s.id;
  insert into servicedesk.ticket_messages (ticket_id, author_id, body, internal)
  values (t.id, me, servicedesk.ref(s.number) || ' from ' || coalesce(servicedesk.employee_name(s.requester_id), 'someone') || ' was merged into this ticket:' || E'\n\n> ' || left(s.subject, 200), true);
  if s.requester_id <> t.requester_id then
    insert into servicedesk.ticket_followers (ticket_id, employee_id, added_by) values (t.id, s.requester_id, me) on conflict do nothing;
  end if;
  insert into servicedesk.ticket_followers (ticket_id, employee_id, added_by)
  select t.id, f.employee_id, me from servicedesk.ticket_followers f where f.ticket_id = s.id and f.employee_id <> t.requester_id
  on conflict do nothing;
  perform set_config('servicedesk.system', prev, true);
end $$;

grant select, insert, update, delete on servicedesk.agent_profiles, servicedesk.canned_responses, servicedesk.ticket_followers,
  servicedesk.incidents, servicedesk.incident_updates, servicedesk.incident_subscribers to authenticated;
grant all on servicedesk.agent_profiles, servicedesk.canned_responses, servicedesk.ticket_followers,
  servicedesk.incidents, servicedesk.incident_updates, servicedesk.incident_subscribers to service_role;
revoke update, delete on servicedesk.incident_updates from authenticated;


-- Auto-assign skips agents who are away.
create or replace function servicedesk.pick_assignee(p_team uuid)
returns uuid language sql stable security definer set search_path = servicedesk, public as $$
  select m.employee_id
  from servicedesk.team_members m
  join public.employees e on e.id = m.employee_id and e.status <> 'exited'
  left join servicedesk.tickets t on t.assignee_id = m.employee_id and t.status in ('new','open','pending')
  where m.team_id = p_team and not servicedesk.is_away(m.employee_id)
  group by m.employee_id, m.role, m.created_at
  order by (m.role = 'lead'), count(t.id), m.created_at
  limit 1
$$;

-- Pending reminders are tracked by the database.
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
         or new.source is distinct from old.source or new.created_by is distinct from old.created_by
         or new.catalog_item_id is distinct from old.catalog_item_id or new.form_data is distinct from old.form_data
         or new.type is distinct from old.type then
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
      new.pending_reminded_at := old.pending_reminded_at;
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
    if new.status = 'pending' then new.pending_since := now(); new.pending_reminded_at := null; end if;
    if new.status <> 'pending' then new.pending_reminded_at := null; end if;
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

-- Followers hear about resolutions; incident links and merges are logged.
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
      perform servicedesk.notify_followers(new.id, ref || ' was resolved', new.subject, rlink);
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

  if new.incident_id is distinct from old.incident_id then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value, to_value)
    values (new.id, actor, 'incident', (select title from servicedesk.incidents where id = old.incident_id), (select title from servicedesk.incidents where id = new.incident_id));
  end if;

  if new.merged_into is distinct from old.merged_into and new.merged_into is not null then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, to_value)
    values (new.id, actor, 'merged', (select servicedesk.ref(number) from servicedesk.tickets where id = new.merged_into));
  end if;

  if new.asset_id is distinct from old.asset_id then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value, to_value)
    values (new.id, actor, 'asset', (select asset_tag from servicedesk.assets where id = old.asset_id), (select asset_tag from servicedesk.assets where id = new.asset_id));
  end if;
  return new;
end $$;

-- Followers reply on the requester's side; only team members count as a first response.
create or replace function servicedesk.messages_after_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  t servicedesk.tickets;
  ref text;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
  requester_side boolean;
begin
  select * into t from servicedesk.tickets where id = new.ticket_id;
  ref := servicedesk.ref(t.number);
  if t.source = 'migrated' and prev = 'on' then return new; end if;
  perform set_config('servicedesk.system', 'on', true);

  requester_side := new.author_id = t.requester_id or exists (select 1 from servicedesk.ticket_followers f where f.ticket_id = t.id and f.employee_id = new.author_id);

  if not new.internal and not requester_side and servicedesk.is_team_member(t.team_id, new.author_id) and t.first_responded_at is null and t.source <> 'migrated' then
    update servicedesk.tickets
       set first_responded_at = now(),
           response_breached = response_breached or (first_response_due is not null and now() > first_response_due)
     where id = t.id;
  end if;

  if requester_side and t.status = 'pending' then
    update servicedesk.tickets set status = 'open' where id = t.id;
  else
    update servicedesk.tickets set updated_at = now() where id = t.id;
  end if;

  perform set_config('servicedesk.system', prev, true);

  if new.internal then
    if t.assignee_id is distinct from new.author_id then
      perform servicedesk.notify(t.assignee_id, 'Internal note on ' || ref, left(new.body, 140), '/desk/tickets/' || t.number, t.id);
    end if;
  elsif requester_side then
    if t.assignee_id is not null then
      perform servicedesk.notify(t.assignee_id, 'New reply on ' || ref, left(new.body, 140), '/desk/tickets/' || t.number, t.id);
    else
      perform servicedesk.notify_leads(t.team_id, 'New reply on ' || ref, left(new.body, 140), '/desk/tickets/' || t.number, t.id);
    end if;
  else
    perform servicedesk.notify(t.requester_id, 'Update on ' || ref, left(new.body, 140), '/requests/' || t.number, t.id, true);
    perform servicedesk.notify_followers(t.id, 'Update on ' || ref, left(new.body, 140), '/requests/' || t.number, new.author_id);
  end if;
  return new;
end $$;

-- Pending tickets: a reminder after N working days, auto-resolve after M.
create or replace function servicedesk.run_sla_checks()
returns int language plpgsql security definer set search_path = servicedesk, public as $$
declare
  t record;
  n int := 0;
  close_days int := coalesce((select (value #>> '{}')::int from servicedesk.settings where key = 'auto_close_days'), 7);
  ref text;
  remind_days int := coalesce((select (value #>> '{}')::int from servicedesk.settings where key = 'pending_reminder_days'), 3);
  resolve_days int := coalesce((select (value #>> '{}')::int from servicedesk.settings where key = 'pending_auto_resolve_days'), 5);
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

  for t in select * from servicedesk.tickets
           where status = 'pending' and pending_since is not null and pending_reminded_at is null
             and servicedesk.business_minutes_between(pending_since, now()) >= remind_days * 540 loop
    update servicedesk.tickets set pending_reminded_at = now() where id = t.id;
    perform servicedesk.notify(t.requester_id, 'Reminder: ' || servicedesk.ref(t.number) || ' is waiting for your reply',
      'Reply so we can carry on. We''ll close it automatically if we don''t hear back.', '/requests/' || t.number, t.id, true);
    n := n + 1;
  end loop;

  for t in select * from servicedesk.tickets
           where status = 'pending' and pending_since is not null and pending_reminded_at is not null
             and servicedesk.business_minutes_between(pending_since, now()) >= resolve_days * 540 loop
    insert into servicedesk.ticket_messages (ticket_id, author_id, body, internal)
    values (t.id, null, 'We haven''t heard back, so we''ve marked this as resolved. Reply or reopen it within ' || close_days || ' days if you still need help.', false);
    update servicedesk.tickets set status = 'resolved' where id = t.id;
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


revoke execute on all functions in schema servicedesk from public, anon;
grant execute on all functions in schema servicedesk to authenticated, service_role;
revoke execute on function servicedesk.notify(uuid, text, text, text, uuid, boolean) from authenticated;
revoke execute on function servicedesk.notify_leads(uuid, text, text, text, uuid) from authenticated;
revoke execute on function servicedesk.notify_followers(uuid, text, text, text, uuid) from authenticated;
revoke execute on function servicedesk.run_sla_checks() from authenticated;
revoke execute on function servicedesk.import_hr_helpdesk() from authenticated;
revoke execute on function servicedesk.compute_sla(servicedesk.tickets) from authenticated;
notify pgrst, 'reload schema';
