-- 0005: one notification per event (no floods from system-generated messages), merge notice, ordering fixes.


-- System-written messages don't notify on their own.
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

  -- Messages written by the system (incident resolution, merges, auto-resolve) are announced
  -- by the status-change notification instead, so people get one notification per event.
  if prev = 'on' then return new; end if;

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

-- Resolve tickets first, then post the incident update.
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
  -- Posted after the tickets are resolved, so their requesters get only the "resolved" notice
  -- and subscribers get the "Fixed" notice.
  insert into servicedesk.incident_updates (incident_id, status, body, author_id) values (i.id, 'resolved', trim(p_message), me);
  return n;
end $$;

-- Tell the merged requester where to follow updates.
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
  perform servicedesk.notify(s.requester_id, servicedesk.ref(s.number) || ' was merged into ' || servicedesk.ref(t.number),
    'Follow updates on ' || servicedesk.ref(t.number) || ': ' || t.subject, '/requests/' || t.number, t.id, true);
end $$;
