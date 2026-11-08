-- 0014: People Success HR admins can open every "New joiner IT setup" request (tickets with a joiner_id).
-- People Success links each joiner's onboarding checklist to that request, so any HR admin clicking the
-- link should see it, not only the HR person who added the joiner. They see what a requester sees:
-- the ticket, public replies, events and attachments, never internal notes (messages_read still
-- requires is_ticket_agent for those). They can't reply unless they follow the request.

create or replace function servicedesk.is_hr_viewing_joiner(p_ticket uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select public.is_hr() and exists (select 1 from servicedesk.tickets t where t.id = p_ticket and t.joiner_id is not null)
$$;
revoke execute on function servicedesk.is_hr_viewing_joiner(uuid) from public, anon;
grant execute on function servicedesk.is_hr_viewing_joiner(uuid) to authenticated;

create or replace function servicedesk.can_view_ticket(p_ticket uuid)
returns boolean language sql stable security definer set search_path = servicedesk, public as $$
  select servicedesk.is_ticket_requester(p_ticket) or servicedesk.is_ticket_agent(p_ticket)
      or servicedesk.is_approver_for(p_ticket) or servicedesk.is_ticket_follower(p_ticket)
      or servicedesk.is_hr_viewing_joiner(p_ticket)
$$;

drop policy if exists tickets_read on servicedesk.tickets;
create policy tickets_read on servicedesk.tickets for select to authenticated
  using (requester_id = servicedesk.me() or servicedesk.is_agent(team_id) or servicedesk.is_approver_for(id)
         or servicedesk.is_ticket_follower(id) or (joiner_id is not null and public.is_hr()));

-- Deleting a joiner in People Success failed with "You cannot change this ticket" when they had a
-- new-joiner request: the foreign key's ON DELETE SET NULL runs as the HR user, who isn't an agent
-- of the IT team. Same function as 0011 plus that exemption.
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

  -- The joiner was deleted in People Success: the foreign key clears joiner_id (and the onboarding
  -- task link goes with it). Let that through whoever deleted them; nothing else may change.
  if old.joiner_id is not null and new.joiner_id is null
     and not exists (select 1 from public.employees where id = old.joiner_id) then
    declare chk servicedesk.tickets := old;
    begin
      chk.joiner_id := null;
      if new.onboarding_task_id is null then chk.onboarding_task_id := null; end if;
      chk.updated_at := new.updated_at;
      if row(chk.*) is not distinct from row(new.*) then return new; end if;
    end;
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
