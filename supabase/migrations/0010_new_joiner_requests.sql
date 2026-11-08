-- 0010: New joiners. When People Success starts a joiner's onboarding, its "Laptop, accounts and
-- access" task (auto_key = 'it_setup') opens a "New joiner IT setup" request for IT here, raised for
-- the joiner's manager. Resolving the request ticks the task off; reopening it un-ticks it.
-- Needs People Success's onboarding migration (public.onboarding_tasks). If that isn't there yet,
-- this migration only prepares the desk side; run it again (or re-apply 0010) after People Success.

alter table servicedesk.catalog_items add column if not exists system_key text;
create unique index if not exists catalog_items_system_key on servicedesk.catalog_items (system_key) where system_key is not null;

alter table servicedesk.tickets
  add column if not exists joiner_id uuid references public.employees(id) on delete set null,
  add column if not exists onboarding_task_id uuid;
create unique index if not exists tickets_onboarding_task on servicedesk.tickets (onboarding_task_id) where onboarding_task_id is not null;

-- The catalog item: adopt an existing "New joiner IT setup", otherwise create it for IT.
update servicedesk.catalog_items set system_key = 'new_joiner'
 where id = (select id from servicedesk.catalog_items where name = 'New joiner IT setup' order by created_at limit 1)
   and not exists (select 1 from servicedesk.catalog_items where system_key = 'new_joiner');

insert into servicedesk.catalog_items (team_id, category_id, name, description, icon, fields, approval, default_priority, expected_days, sort_order, system_key)
select t.id,
       (select c.id from servicedesk.categories c where c.team_id = t.id and c.name = 'Hardware' limit 1),
       'New joiner IT setup',
       'Laptop, accounts and access for someone joining your team.',
       'user-plus',
       '[{"key":"joiner","label":"Joiner''s full name","type":"text","required":true},
         {"key":"start_date","label":"Start date","type":"date","required":true},
         {"key":"role","label":"Role","type":"text","required":true},
         {"key":"extra_monitor","label":"Needs an extra monitor","type":"checkbox"}]'::jsonb,
       'none', 'high', 3, 4, 'new_joiner'
  from servicedesk.teams t
 where t.key = 'it'
   and not exists (select 1 from servicedesk.catalog_items where system_key = 'new_joiner');

-- Open the IT setup request for an onboarding task. Returns the ticket number (null if skipped).
create or replace function servicedesk.open_joiner_request(p_task uuid)
returns bigint language plpgsql security definer set search_path = servicedesk, public as $$
declare
  task record;
  e record;
  item servicedesk.catalog_items;
  requester uuid;
  num bigint;
  base text;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
begin
  select id, employee_id into task from public.onboarding_tasks where id = p_task;
  if not found then return null; end if;
  if exists (select 1 from servicedesk.tickets where onboarding_task_id = p_task) then return null; end if;

  select emp.id, emp.full_name, emp.employee_code, emp.email, emp.date_of_joining, emp.employment_type, emp.status,
         emp.manager_id, d.name as department, g.title as designation, l.name as location,
         m.full_name as manager_name, m.status as manager_status
    into e
    from public.employees emp
    left join public.departments d on d.id = emp.department_id
    left join public.designations g on g.id = emp.designation_id
    left join public.locations l on l.id = emp.location_id
    left join public.employees m on m.id = emp.manager_id
   where emp.id = task.employee_id;
  if not found or e.status = 'exited' then return null; end if;
  -- Onboarding started long after someone joined: they already have their kit.
  if e.date_of_joining < current_date - 14 then return null; end if;

  select * into item from servicedesk.catalog_items where system_key = 'new_joiner' and active;
  if not found then return null; end if;

  requester := case when e.manager_id is not null and e.manager_status <> 'exited' then e.manager_id end;
  requester := coalesce(requester, servicedesk.me(), e.id);

  perform set_config('servicedesk.system', 'on', true);
  insert into servicedesk.tickets (team_id, catalog_item_id, requester_id, created_by, type, subject, description, form_data,
                                   priority, source, joiner_id, onboarding_task_id)
  values (
    item.team_id, item.id, requester, servicedesk.me(), 'request',
    left('New joiner IT setup: ' || e.full_name || ' (joins ' || to_char(e.date_of_joining, 'DD Mon YYYY') || ')', 200),
    '**' || e.full_name || '** joins on **' || to_char(e.date_of_joining, 'FMDay, DD Mon YYYY') || '**.' || E'\n\n' ||
    '- Employee code: ' || e.employee_code || E'\n' ||
    '- Work email: ' || e.email || E'\n' ||
    '- Role: ' || coalesce(e.designation, '—') || E'\n' ||
    '- Department: ' || coalesce(e.department, '—') || E'\n' ||
    '- Location: ' || coalesce(e.location, '—') || E'\n' ||
    '- Reporting manager: ' || coalesce(e.manager_name, '—') || E'\n' ||
    '- Employment type: ' || initcap(replace(e.employment_type, '_', ' ')) || E'\n\n' ||
    'Please have their laptop, email, accounts and access ready before day one.' || E'\n\n' ||
    '_Opened automatically by People Success when HR added the employee. Resolving this request ticks off their onboarding task._',
    jsonb_build_object('joiner', e.full_name, 'start_date', e.date_of_joining, 'role', coalesce(e.designation, '—'), 'extra_monitor', false),
    item.default_priority, 'catalog', e.id, p_task
  )
  returning number into num;
  perform set_config('servicedesk.system', prev, true);

  select nullif(rtrim(value #>> '{}', '/'), '') into base from servicedesk.settings where key = 'app_url';
  update public.onboarding_tasks
     set link = case when base is not null then base || '/requests/' || num end,
         link_label = servicedesk.ref(num),
         note = 'Opened for IT in the Service Desk'
   where id = p_task;
  return num;
end $$;
revoke execute on function servicedesk.open_joiner_request(uuid) from public, anon, authenticated;

-- Resolving / reopening the request keeps the onboarding task in step.
create or replace function servicedesk.tickets_onboarding_sync()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if new.onboarding_task_id is null or new.status is not distinct from old.status then return null; end if;
  if new.status in ('resolved','closed') and old.status not in ('resolved','closed') then
    update public.onboarding_tasks
       set status = 'done', completed_at = now(), completed_by = coalesce(new.assignee_id, servicedesk.me()),
           note = 'Resolved in ' || servicedesk.ref(new.number)
     where id = new.onboarding_task_id and status = 'pending';
  elsif new.status in ('new','open','pending') and old.status in ('resolved','closed') then
    update public.onboarding_tasks
       set status = 'pending', completed_at = null, completed_by = null,
           note = 'Reopened in ' || servicedesk.ref(new.number)
     where id = new.onboarding_task_id and status = 'done';
  end if;
  return null;
exception when undefined_table then
  return null;
end $$;
drop trigger if exists tickets_onboarding_sync on servicedesk.tickets;
create trigger tickets_onboarding_sync after update of status on servicedesk.tickets
  for each row execute function servicedesk.tickets_onboarding_sync();

-- The onboarding task → request hook (only when People Success's onboarding is installed).
create or replace function servicedesk.onboarding_task_created()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if new.auto_key = 'it_setup' and new.status = 'pending' then
    begin
      perform servicedesk.open_joiner_request(new.id);
    exception when others then
      raise warning 'Service Desk request not opened for onboarding task %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

do $$
begin
  if to_regclass('public.onboarding_tasks') is null then
    raise notice 'public.onboarding_tasks not found: apply People Success''s onboarding migration, then re-run this one';
    return;
  end if;
  execute 'drop trigger if exists onboarding_tasks_service_desk on public.onboarding_tasks';
  execute 'create trigger onboarding_tasks_service_desk after insert on public.onboarding_tasks
           for each row execute function servicedesk.onboarding_task_created()';
end $$;
