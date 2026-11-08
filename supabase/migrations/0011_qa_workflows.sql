-- 0011: fixes from the requester/agent workflow QA pass.
--  1. Attachments can only point at files stored under their own ticket (and messages of that ticket).
--  2. A request closed (withdrawn / merged) while it waits for approval cancels the approval, so the
--     approver can no longer approve a closed request (which used to assign it and ping the team).
--  3. Closed tickets that were merged, rejected or withdrawn can't be reopened.
--  4. Resolving straight from "pending" judges the resolution SLA against the pause-adjusted target.
--  5. Merge / joiner links are owned by the database (agents can't set them through the API).
--  6. Incident updates are always credited to the person who posted them; incidents only link to and
--     resolve tickets of their own team.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Attachments
-- ---------------------------------------------------------------------------
drop policy if exists attachments_insert on servicedesk.attachments;
create policy attachments_insert on servicedesk.attachments for insert to authenticated
  with check (
    uploaded_by = servicedesk.me()
    and (servicedesk.is_ticket_requester(ticket_id) or servicedesk.is_ticket_agent(ticket_id) or servicedesk.is_ticket_follower(ticket_id))
    and path like 'tickets/' || ticket_id::text || '/%'
    and path !~ '(^|/)\.\.?(/|$)'  -- no . or .. segments (dots inside a file name are fine)
    and (message_id is null or exists (select 1 from servicedesk.ticket_messages m where m.id = message_id and m.ticket_id = attachments.ticket_id))
  );

-- ---------------------------------------------------------------------------
-- 2. Withdrawn approvals
-- ---------------------------------------------------------------------------
alter table servicedesk.tickets drop constraint if exists tickets_approval_status_check;
alter table servicedesk.tickets add constraint tickets_approval_status_check
  check (approval_status in ('not_required','pending','approved','rejected','cancelled'));
alter table servicedesk.approvals drop constraint if exists approvals_status_check;
alter table servicedesk.approvals add constraint approvals_status_check
  check (status in ('pending','approved','rejected','cancelled'));

create or replace function servicedesk.tickets_cancel_approvals()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if new.approval_status = 'cancelled' and old.approval_status = 'pending' then
    update servicedesk.approvals
       set status = 'cancelled', decided_at = now(),
           comment = coalesce(comment, case when new.merged_into is not null then 'Merged into another request before a decision'
                                            else 'Withdrawn before a decision' end)
     where ticket_id = new.id and status = 'pending';
  end if;
  return null;
end $$;
drop trigger if exists tickets_cancel_approvals on servicedesk.tickets;
-- Not "update of approval_status": the column is set by the before-update trigger, not the statement.
create trigger tickets_cancel_approvals after update on servicedesk.tickets
  for each row when (old.approval_status = 'pending' and new.approval_status = 'cancelled')
  execute function servicedesk.tickets_cancel_approvals();

-- Requests that were already closed while waiting: cancel them now.
do $$
begin
  perform set_config('servicedesk.system', 'on', true);
  update servicedesk.tickets set approval_status = 'cancelled' where status = 'closed' and approval_status = 'pending';
  update servicedesk.approvals a set status = 'cancelled', decided_at = now(), comment = coalesce(a.comment, 'Withdrawn before a decision')
   where a.status = 'pending' and exists (select 1 from servicedesk.tickets t where t.id = a.ticket_id and t.status = 'closed');
  perform set_config('servicedesk.system', '', true);
end $$;

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
  if a.status = 'cancelled' then raise exception 'This request was withdrawn, so there is nothing to decide'; end if;
  if a.status <> 'pending' then raise exception 'This request was already %', a.status; end if;
  if not (a.approver_id = me or (a.team_id is not null and servicedesk.is_lead(a.team_id))) then
    raise exception 'You are not an approver for this request';
  end if;
  select * into t from servicedesk.tickets where id = a.ticket_id for update;
  if t.requester_id = me and not servicedesk.is_admin() then raise exception 'You cannot approve your own request'; end if;
  if t.status = 'closed' or t.approval_status <> 'pending' then raise exception 'This request was withdrawn, so there is nothing to decide'; end if;
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

-- ---------------------------------------------------------------------------
-- 3–5. Ticket update rules
-- ---------------------------------------------------------------------------
create or replace function servicedesk.tickets_before_update()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
declare
  me uuid := servicedesk.me();
  user_ctx boolean := auth.uid() is not null and not servicedesk.system_mode();
  agent boolean;
  allowed servicedesk.tickets;
  close_days int := coalesce((select (value #>> '{}')::int from servicedesk.settings where key = 'auto_close_days'), 7);
  recompute boolean := false;
  leaving_pending boolean := false;
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
         or new.type is distinct from old.type or new.merged_into is distinct from old.merged_into
         or new.joiner_id is distinct from old.joiner_id or new.onboarding_task_id is distinct from old.onboarding_task_id then
        raise exception 'These ticket fields are read-only';
      end if;
      if new.csat_rating is distinct from old.csat_rating or new.csat_comment is distinct from old.csat_comment or new.csat_at is distinct from old.csat_at then
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

    -- Closed for good: merged, rejected or withdrawn tickets stay closed.
    if old.status = 'closed' and new.status is distinct from 'closed' then
      if old.merged_into is not null then
        raise exception 'This ticket was merged into another one, so it can''t be reopened. Carry on there.';
      elsif old.approval_status = 'rejected' then
        raise exception 'This request wasn''t approved, so it can''t be reopened. Raise a new request instead.';
      elsif old.approval_status = 'cancelled' then
        raise exception 'This request was withdrawn, so it can''t be reopened. Raise a new request instead.';
      end if;
    end if;
  end if;

  -- Closing a request that is still waiting for approval withdraws it (the approval is cancelled).
  if new.status = 'closed' and old.status <> 'closed' and new.approval_status = 'pending' then
    new.approval_status := 'cancelled';
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

  -- A ticket can only be linked to an incident of its own team (a transfer drops the link).
  if new.incident_id is not null and (new.incident_id is distinct from old.incident_id or new.team_id is distinct from old.team_id)
     and not exists (select 1 from servicedesk.incidents i where i.id = new.incident_id and i.team_id = new.team_id) then
    if new.incident_id is not distinct from old.incident_id then
      new.incident_id := null;
    else
      raise exception 'Choose an incident of this ticket''s team';
    end if;
  end if;

  if new.status = 'new' and new.assignee_id is not null and new.approval_status <> 'pending' then new.status := 'open'; end if;

  -- Leaving "pending" banks the paused time, and the targets move out by that much
  -- before anything below is judged against them.
  if new.status is distinct from old.status and old.status = 'pending' and old.pending_since is not null then
    new.sla_paused_minutes := old.sla_paused_minutes + servicedesk.business_minutes_between(old.pending_since, now());
    new.pending_since := null;
    leaving_pending := true;
    recompute := true;
  end if;
  if new.priority is distinct from old.priority or new.approved_at is distinct from old.approved_at then recompute := true; end if;
  if recompute and (new.status not in ('resolved','closed') or leaving_pending) then
    new := servicedesk.compute_sla(new);
  end if;

  -- Status side effects.
  if new.status is distinct from old.status then
    if new.status = 'pending' then new.pending_since := now(); new.pending_reminded_at := null; end if;
    if new.status <> 'pending' then new.pending_reminded_at := null; end if;
    if new.status = 'resolved' then
      new.resolved_at := now();
      new.resolution_breached := old.resolution_breached or (new.resolution_due is not null and now() > new.resolution_due);
    elsif old.status = 'resolved' and new.status in ('new','open','pending') then
      new.resolved_at := null;
    end if;
    if new.status = 'closed' then
      new.closed_at := now();
    elsif old.status = 'closed' then
      new.closed_at := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- Resolving an incident only touches its own team's tickets.
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
    for t in select id from servicedesk.tickets
             where incident_id = i.id and team_id = i.team_id and status in ('new','open','pending') and approval_status <> 'pending' loop
      insert into servicedesk.ticket_messages (ticket_id, author_id, body, internal)
      values (t.id, me, 'Fixed as part of incident “' || i.title || '”: ' || trim(p_message), false);
      update servicedesk.tickets set status = 'resolved' where id = t.id;
      n := n + 1;
    end loop;
    perform set_config('servicedesk.system', prev, true);
  end if;
  insert into servicedesk.incident_updates (incident_id, status, body, author_id) values (i.id, 'resolved', trim(p_message), me);
  return n;
end $$;

-- Existing cross-team links (from before this rule) are dropped.
do $$
begin
  perform set_config('servicedesk.system', 'on', true);
  update servicedesk.tickets t set incident_id = null
   where t.incident_id is not null and not exists (select 1 from servicedesk.incidents i where i.id = t.incident_id and i.team_id = t.team_id);
  perform set_config('servicedesk.system', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Incident updates are credited to their author
-- ---------------------------------------------------------------------------
create or replace function servicedesk.incident_updates_before_insert()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if auth.uid() is not null and not servicedesk.system_mode() then
    new.author_id := servicedesk.me();
    new.created_at := now();
  end if;
  return new;
end $$;
drop trigger if exists incident_updates_before_insert on servicedesk.incident_updates;
create trigger incident_updates_before_insert before insert on servicedesk.incident_updates
  for each row execute function servicedesk.incident_updates_before_insert();

-- ---------------------------------------------------------------------------
-- 7. Assets: hand them only to current employees; tags are unique regardless of case
-- ---------------------------------------------------------------------------
create or replace function servicedesk.assets_holder_active()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.employees e where e.id = new.assigned_to and e.status <> 'exited') then
    raise exception 'Choose someone who still works here';
  end if;
  return new;
end $$;
drop trigger if exists assets_holder_active on servicedesk.assets;
create trigger assets_holder_active before insert or update on servicedesk.assets
  for each row execute function servicedesk.assets_holder_active();

do $$
begin
  if not exists (select 1 from servicedesk.assets group by lower(asset_tag) having count(*) > 1) then
    create unique index if not exists assets_asset_tag_lower on servicedesk.assets (lower(asset_tag));
  else
    raise notice 'Asset tags differ only by case; unique index on lower(asset_tag) not created';
  end if;
end $$;

revoke execute on function servicedesk.assets_holder_active() from public, anon, authenticated;
revoke execute on function servicedesk.tickets_cancel_approvals() from public, anon, authenticated;
revoke execute on function servicedesk.incident_updates_before_insert() from public, anon, authenticated;
notify pgrst, 'reload schema';
