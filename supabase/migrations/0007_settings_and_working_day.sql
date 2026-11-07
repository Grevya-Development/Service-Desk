-- 0007: validate follow-up settings; working-day length follows business hours.


create or replace function servicedesk.business_day_minutes()
returns int language sql stable security definer set search_path = servicedesk as $$
  select greatest(1, (extract(epoch from ((cfg->>'end')::time - (cfg->>'start')::time)) / 60)::int)
  from (select servicedesk.business_hours() as cfg) x
$$;
grant execute on function servicedesk.business_day_minutes() to authenticated, service_role;

create or replace function servicedesk.settings_validate()
returns trigger language plpgsql as $$
declare
  d text;
  lo int;
  hi int;
begin
  if new.key = 'business_hours' then
    if jsonb_typeof(new.value) <> 'object'
       or not exists (select 1 from pg_timezone_names where name = new.value->>'timezone')
       or jsonb_typeof(new.value->'days') <> 'array' or jsonb_array_length(new.value->'days') = 0 then
      raise exception 'Business hours need a valid time zone and at least one working day';
    end if;
    for d in select jsonb_array_elements_text(new.value->'days') loop
      if d !~ '^[1-7]$' then raise exception 'Working days must be 1 (Mon) to 7 (Sun)'; end if;
    end loop;
    if (new.value->>'start') !~ '^\d{2}:\d{2}$' or (new.value->>'end') !~ '^\d{2}:\d{2}$'
       or (new.value->>'start')::time >= (new.value->>'end')::time then
      raise exception 'Business hours need a start time before the end time';
    end if;
  elsif new.key in ('pending_reminder_days', 'pending_auto_resolve_days') then
    lo := 1; hi := 30;
    if new.key = 'pending_auto_resolve_days' then lo := 2; hi := 60; end if;
    if jsonb_typeof(new.value) <> 'number' or (new.value #>> '{}')::numeric <> trunc((new.value #>> '{}')::numeric)
       or (new.value #>> '{}')::int not between lo and hi then
      raise exception 'Enter a whole number of working days between % and %', lo, hi;
    end if;
  elsif new.key = 'auto_close_days' then
    if jsonb_typeof(new.value) <> 'number' or (new.value #>> '{}')::int not between 1 and 60 then
      raise exception 'Auto-close must be between 1 and 60 days';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

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
             and servicedesk.business_minutes_between(pending_since, now()) >= remind_days * servicedesk.business_day_minutes() loop
    update servicedesk.tickets set pending_reminded_at = now() where id = t.id;
    perform servicedesk.notify(t.requester_id, 'Reminder: ' || servicedesk.ref(t.number) || ' is waiting for your reply',
      'Reply so we can carry on. We''ll close it automatically if we don''t hear back.', '/requests/' || t.number, t.id, true);
    n := n + 1;
  end loop;

  for t in select * from servicedesk.tickets
           where status = 'pending' and pending_since is not null and pending_reminded_at is not null
             and servicedesk.business_minutes_between(pending_since, now()) >= resolve_days * servicedesk.business_day_minutes() loop
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
