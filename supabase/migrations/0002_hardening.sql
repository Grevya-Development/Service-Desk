-- Hardening found during the build review.

-- 1. Leads may edit their team's description/colour/icon/auto-assign only.
create or replace function servicedesk.teams_guard_update()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if auth.uid() is not null and not servicedesk.is_admin() and (
       new.key is distinct from old.key or new.name is distinct from old.name
    or new.active is distinct from old.active or new.manages_assets is distinct from old.manages_assets
    or new.sort_order is distinct from old.sort_order) then
    raise exception 'Only desk admins can change a team''s name, code, status or asset access';
  end if;
  return new;
end $$;
create trigger teams_guard_update before update on servicedesk.teams
  for each row execute function servicedesk.teams_guard_update();

-- 2. A team keeps at least one lead (desk admins may override).
create or replace function servicedesk.members_guard_last_lead()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare t uuid := old.team_id;
begin
  if auth.uid() is null or servicedesk.is_admin() then return coalesce(new, old); end if;
  if old.role = 'lead' and (tg_op = 'DELETE' or new.role <> 'lead') then
    if not exists (select 1 from servicedesk.team_members m where m.team_id = t and m.role = 'lead' and m.employee_id <> old.employee_id) then
      raise exception 'A team needs at least one lead';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger members_guard_last_lead before update or delete on servicedesk.team_members
  for each row execute function servicedesk.members_guard_last_lead();

-- 3. Business hours must stay valid, or every ticket insert would fail.
create or replace function servicedesk.settings_validate()
returns trigger language plpgsql as $$
declare d text;
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
  elsif new.key = 'auto_close_days' then
    if jsonb_typeof(new.value) <> 'number' or (new.value #>> '{}')::int not between 1 and 60 then
      raise exception 'Auto-close must be between 1 and 60 days';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger settings_validate before insert or update on servicedesk.settings
  for each row execute function servicedesk.settings_validate();

-- 4. Catalog items and articles may only use their own team's categories.
create or replace function servicedesk.category_matches_team()
returns trigger language plpgsql security definer set search_path = servicedesk as $$
begin
  if new.category_id is not null and not exists (
    select 1 from servicedesk.categories c where c.id = new.category_id and c.team_id = new.team_id
  ) then
    raise exception 'That category belongs to another team';
  end if;
  return new;
end $$;
create trigger catalog_items_category_team before insert or update on servicedesk.catalog_items
  for each row execute function servicedesk.category_matches_team();
create trigger kb_articles_category_team before insert or update on servicedesk.kb_articles
  for each row execute function servicedesk.category_matches_team();

-- 5. Votes only on articles the voter can read (exists() runs under RLS).
drop policy kb_feedback_write on servicedesk.kb_feedback;
create policy kb_feedback_write on servicedesk.kb_feedback for all to authenticated
  using (employee_id = servicedesk.me())
  with check (employee_id = servicedesk.me() and exists (select 1 from servicedesk.kb_articles a where a.id = article_id));

-- 6. Manager approval skips managers who have left (falls back to a team lead).
create or replace function servicedesk.active_manager_of(p_emp uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.id from public.employees e join public.employees m on m.id = e.manager_id and m.status <> 'exited'
  where e.id = p_emp and m.id <> p_emp
$$;
grant execute on function servicedesk.active_manager_of(uuid) to authenticated;

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
      mgr := servicedesk.active_manager_of(new.requester_id);
      if mgr is null then kind := 'team_lead'; end if;
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

-- 7. A request's catalog item, answers and type are fixed once raised.
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
