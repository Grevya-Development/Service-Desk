-- 0012: QA fixes for administration and the People Success integration.
--  * HR Helpdesk import: two admins clicking at once no longer collide, and old tickets the desk's
--    rules would reject (subject under 3 characters, empty description, empty or very long comments)
--    are tidied up instead of failing the whole import.
--  * New joiner requests:
--      - the HR person who added the joiner follows the request, so the link in People Success opens
--        for them (it used to 404 for everyone but the manager);
--      - when no request is opened (service switched off, IT team inactive, joined long ago) the
--        onboarding task says why instead of promising a request that never comes;
--      - a rebuilt checklist reuses the joiner's open request instead of opening a second one;
--      - People Success changes reach IT: the task skipped (e.g. the joiner exited), removed
--        (e.g. the employee was deleted) or ticked off by HR, and the start date or manager
--        changing, each add an internal note to the open request and notify IT.
-- Idempotent: safe to run again.

-- ---------------------------------------------------------------------------
-- HR Helpdesk import
-- ---------------------------------------------------------------------------
create or replace function servicedesk.import_hr_helpdesk()
returns integer language plpgsql security definer set search_path = servicedesk, public as $$
declare
  hr uuid := (select id from servicedesk.teams where key = 'hr');
  it uuid := (select id from servicedesk.teams where key = 'it');
  r record;
  c record;
  new_id uuid;
  team uuid;
  cat uuid;
  subj text;
  n int := 0;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
begin
  if hr is null then raise exception 'HR team is missing'; end if;
  -- A second import started at the same time waits here, then finds nothing left to copy.
  perform pg_advisory_xact_lock(hashtext('servicedesk.import_hr_helpdesk'));
  perform set_config('servicedesk.system', 'on', true);
  for r in select * from public.helpdesk_tickets h where not exists (select 1 from servicedesk.tickets t where t.legacy_id = h.id) order by h.created_at loop
    begin
      team := case when r.category = 'IT & Access' and it is not null then it else hr end;
      cat := null;
      select id into cat from servicedesk.categories
       where team_id = team and name = case when r.category = 'IT & Access' then 'Access & Accounts' else r.category end;
      if cat is null then select id into cat from servicedesk.categories where team_id = team and name = 'Other'; end if;
      subj := btrim(coalesce(r.subject, ''));
      if length(subj) < 3 then subj := 'HR Helpdesk ticket HD-' || r.seq || case when subj <> '' then ': ' || subj else '' end; end if;
      insert into servicedesk.tickets (team_id, category_id, requester_id, created_by, assignee_id, type, subject, description,
                                       priority, status, source, resolved_at, closed_at, legacy_id, legacy_ref, created_at)
      values (team, cat, r.employee_id, r.employee_id,
              case when exists (select 1 from servicedesk.team_members m where m.team_id = team and m.employee_id = r.assigned_to) then r.assigned_to end,
              'incident', left(subj, 200), left(coalesce(nullif(btrim(r.description), ''), '(No description)'), 20000), r.priority,
              case r.status when 'in_progress' then 'open' else r.status end,
              'migrated',
              case when r.status in ('resolved','closed') then coalesce(r.resolved_at, r.updated_at) end,
              case when r.status = 'closed' then r.updated_at end,
              r.id, 'HD-' || r.seq, r.created_at)
      returning id into new_id;
      for c in select * from public.ticket_comments where ticket_id = r.id and btrim(body) <> '' order by created_at loop
        insert into servicedesk.ticket_messages (ticket_id, author_id, body, internal, created_at)
        values (new_id, c.author_id, left(c.body, 20000), false, c.created_at);
      end loop;
      n := n + 1;
    exception when others then
      -- One bad old ticket must not block the rest; it stays in "Waiting" on the settings page.
      raise warning 'HR Helpdesk ticket HD-% not imported: %', r.seq, sqlerrm;
    end;
  end loop;
  perform set_config('servicedesk.system', prev, true);
  return n;
end $$;
revoke execute on function servicedesk.import_hr_helpdesk() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- New joiner IT setup request
-- ---------------------------------------------------------------------------
create index if not exists tickets_joiner on servicedesk.tickets (joiner_id) where joiner_id is not null;

create or replace function servicedesk.open_joiner_request(p_task uuid)
returns bigint language plpgsql security definer set search_path = servicedesk, public as $$
declare
  task record;
  e record;
  item servicedesk.catalog_items;
  tm servicedesk.teams;
  existing record;
  requester uuid;
  me uuid := servicedesk.me();
  tid uuid;
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
  if e.date_of_joining < current_date - 14 then
    update public.onboarding_tasks set note = 'No IT request opened: they joined more than two weeks ago.' where id = p_task;
    return null;
  end if;

  -- The checklist was rebuilt (task removed and added again): keep using the joiner's open request.
  select id, number into existing from servicedesk.tickets
   where joiner_id = e.id and onboarding_task_id is null and status not in ('resolved','closed')
   order by created_at desc limit 1;
  if found then
    perform set_config('servicedesk.system', 'on', true);
    update servicedesk.tickets set onboarding_task_id = p_task where id = existing.id;
    perform set_config('servicedesk.system', prev, true);
    num := existing.number;
  else
    select * into item from servicedesk.catalog_items where system_key = 'new_joiner';
    if found then select * into tm from servicedesk.teams where id = item.team_id; end if;
    if item.id is null or not item.active or not coalesce(tm.active, false) then
      update public.onboarding_tasks
         set note = 'No IT request opened: the “New joiner IT setup” service is switched off in the Service Desk. Ask IT directly.'
       where id = p_task;
      return null;
    end if;

    requester := case when e.manager_id is not null and e.manager_status <> 'exited' then e.manager_id end;
    requester := coalesce(requester, me, e.id);

    perform set_config('servicedesk.system', 'on', true);
    insert into servicedesk.tickets (team_id, catalog_item_id, requester_id, created_by, type, subject, description, form_data,
                                     priority, source, joiner_id, onboarding_task_id)
    values (
      item.team_id, item.id, requester, me, 'request',
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
      '*Opened automatically by People Success when HR added the employee. Resolving this request ticks off their onboarding task.*',
      jsonb_build_object('joiner', e.full_name, 'start_date', e.date_of_joining, 'role', coalesce(e.designation, '—'), 'extra_monitor', false),
      item.default_priority, 'catalog', e.id, p_task
    )
    returning id, number into tid, num;

    -- The HR person who added the joiner follows the request, so they can open it from People Success.
    if me is not null and me <> requester then
      begin
        insert into servicedesk.ticket_followers (ticket_id, employee_id, added_by) values (tid, me, me) on conflict do nothing;
      exception when others then
        raise warning 'Could not add % as a follower of %: %', me, servicedesk.ref(num), sqlerrm;
      end;
    end if;
    perform set_config('servicedesk.system', prev, true);
  end if;

  select nullif(rtrim(value #>> '{}', '/'), '') into base from servicedesk.settings where key = 'app_url';
  update public.onboarding_tasks
     set link = case when base is not null then base || '/requests/' || num end,
         link_label = servicedesk.ref(num),
         note = 'Opened for IT in the Service Desk'
   where id = p_task;
  return num;
end $$;
revoke execute on function servicedesk.open_joiner_request(uuid) from public, anon, authenticated;

-- The desk's Markdown renders *italic*, not _italic_: fix the closing line on requests opened before this.
update servicedesk.tickets
   set description = replace(description,
         '_Opened automatically by People Success when HR added the employee. Resolving this request ticks off their onboarding task._',
         '*Opened automatically by People Success when HR added the employee. Resolving this request ticks off their onboarding task.*')
 where catalog_item_id = (select id from servicedesk.catalog_items where system_key = 'new_joiner')
   and description like '%\_Opened automatically by People Success%';

-- Internal note on a joiner's open request + a notification for whoever handles it.
create or replace function servicedesk.joiner_note(p_ticket uuid, p_body text)
returns void language plpgsql security definer set search_path = servicedesk, public as $$
declare
  t servicedesk.tickets;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
  title text;
begin
  select * into t from servicedesk.tickets where id = p_ticket;
  if not found or t.status in ('resolved','closed') then return; end if;
  perform set_config('servicedesk.system', 'on', true);
  insert into servicedesk.ticket_messages (ticket_id, author_id, body, internal) values (t.id, null, left(p_body, 20000), true);
  perform set_config('servicedesk.system', prev, true);
  title := 'Joiner update on ' || servicedesk.ref(t.number);
  if t.assignee_id is not null then
    perform servicedesk.notify(t.assignee_id, title, left(p_body, 140), '/desk/tickets/' || t.number, t.id);
  else
    perform servicedesk.notify_leads(t.team_id, title, left(p_body, 140), '/desk/tickets/' || t.number, t.id);
  end if;
end $$;
revoke execute on function servicedesk.joiner_note(uuid, text) from public, anon, authenticated;

-- The IT setup task changed in People Success (skipped, ticked off by HR, removed).
create or replace function servicedesk.onboarding_task_changed()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  tid uuid;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
  who text;
begin
  if tg_op = 'DELETE' then
    if old.auto_key is distinct from 'it_setup' then return null; end if;
    select id into tid from servicedesk.tickets where onboarding_task_id = old.id;
    if tid is null then return null; end if;
    perform set_config('servicedesk.system', 'on', true);
    update servicedesk.tickets set onboarding_task_id = null where id = tid;
    perform set_config('servicedesk.system', prev, true);
    perform servicedesk.joiner_note(tid,
      'People Success: this joiner''s IT setup task was removed' ||
      case when not exists (select 1 from public.employees where id = old.employee_id) then ' because the employee was deleted' else '' end ||
      '. Check whether this request is still needed before working on it.');
    return null;
  end if;

  if new.auto_key is distinct from 'it_setup' or new.status is not distinct from old.status then return null; end if;
  select id into tid from servicedesk.tickets where onboarding_task_id = new.id;
  if tid is null then return null; end if;
  -- joiner_note() skips requests that are already resolved (e.g. this change came from resolving it).
  if new.status = 'skipped' then
    perform servicedesk.joiner_note(tid,
      'People Success: the IT setup task was skipped' || coalesce(' (' || nullif(btrim(new.note), '') || ')', '') ||
      '. Check whether this request is still needed before working on it.');
  elsif new.status = 'done' then
    select full_name into who from public.employees where id = new.completed_by;
    perform servicedesk.joiner_note(tid,
      'People Success: ' || coalesce(who, 'HR') || ' marked the IT setup task as done. Resolve this request once the setup is complete.');
  end if;
  return null;
exception when others then
  raise warning 'Service Desk not updated for onboarding task %: %', coalesce(new.id, old.id), sqlerrm;
  return null;
end $$;

-- The joiner's start date or manager changed in People Success.
create or replace function servicedesk.joiner_details_changed()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  t record;
  msg text;
  prev text := coalesce(current_setting('servicedesk.system', true), '');
  mgr text;
begin
  if new.date_of_joining is not distinct from old.date_of_joining and new.manager_id is not distinct from old.manager_id then
    return null;
  end if;
  for t in select id from servicedesk.tickets where joiner_id = new.id and status not in ('resolved','closed') loop
    msg := null;
    if new.date_of_joining is distinct from old.date_of_joining then
      msg := 'People Success: ' || new.full_name || '''s start date moved from ' || to_char(old.date_of_joining, 'DD Mon YYYY') ||
             ' to ' || to_char(new.date_of_joining, 'FMDay, DD Mon YYYY') || '.';
      perform set_config('servicedesk.system', 'on', true);
      update servicedesk.tickets
         set form_data = coalesce(form_data, '{}'::jsonb) || jsonb_build_object('start_date', new.date_of_joining),
             -- keep the automatic subject's "(joins …)" in step; a subject an agent rewrote is left alone
             subject = replace(subject, '(joins ' || to_char(old.date_of_joining, 'DD Mon YYYY') || ')',
                                        '(joins ' || to_char(new.date_of_joining, 'DD Mon YYYY') || ')')
       where id = t.id;
      perform set_config('servicedesk.system', prev, true);
    end if;
    if new.manager_id is distinct from old.manager_id then
      select full_name into mgr from public.employees where id = new.manager_id;
      msg := coalesce(msg || ' ', 'People Success: ') || 'Reporting manager is now ' || coalesce(mgr, 'not set') || '.';
    end if;
    perform servicedesk.joiner_note(t.id, msg);
  end loop;
  return null;
exception when others then
  raise warning 'Service Desk not updated for employee %: %', new.id, sqlerrm;
  return null;
end $$;

do $$
begin
  if to_regclass('public.onboarding_tasks') is null then
    raise notice 'public.onboarding_tasks not found: apply People Success''s onboarding migration, then re-run this one';
    return;
  end if;
  execute 'drop trigger if exists onboarding_tasks_service_desk_sync on public.onboarding_tasks';
  execute 'create trigger onboarding_tasks_service_desk_sync after update of status or delete on public.onboarding_tasks
           for each row execute function servicedesk.onboarding_task_changed()';
  execute 'drop trigger if exists employees_service_desk_joiner on public.employees';
  execute 'create trigger employees_service_desk_joiner after update of date_of_joining, manager_id on public.employees
           for each row execute function servicedesk.joiner_details_changed()';
end $$;

-- ---------------------------------------------------------------------------
-- System catalog items (system_key, e.g. 'new_joiner') are used by People Success: they can be
-- hidden but not deleted, and only migrations set or change the key.
-- ---------------------------------------------------------------------------
create or replace function servicedesk.catalog_items_guard_system()
returns trigger language plpgsql set search_path = servicedesk, public as $$
begin
  if auth.uid() is null or servicedesk.system_mode() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.system_key is not null then
      raise exception '“%” is used by People Success, so it can''t be deleted. Hide it instead.', old.name;
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.system_key := null;
  elsif new.system_key is distinct from old.system_key then
    new.system_key := old.system_key;
  end if;
  return new;
end $$;
drop trigger if exists catalog_items_guard_system on servicedesk.catalog_items;
create trigger catalog_items_guard_system before insert or update or delete on servicedesk.catalog_items
  for each row execute function servicedesk.catalog_items_guard_system();
