-- 0006: transferring a ticket to a team the agent isn't on; history when a follower is removed.

-- Row-level security also checks the updated row against the read rule, so an agent couldn't move a
-- ticket out of their own teams. This function performs the move after checking the agent may do it;
-- the ticket triggers still validate category/assignee and log the change under the agent's name.
create or replace function servicedesk.transfer_ticket(p_ticket uuid, p_team uuid, p_category uuid default null, p_assignee uuid default null)
returns void language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if not servicedesk.is_ticket_agent(p_ticket) then raise exception 'Only agents of this team can transfer it'; end if;
  if not exists (select 1 from servicedesk.teams where id = p_team and active) then raise exception 'That team is not accepting tickets'; end if;
  update servicedesk.tickets set team_id = p_team, category_id = p_category, assignee_id = p_assignee where id = p_ticket;
end $$;
revoke execute on function servicedesk.transfer_ticket(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function servicedesk.transfer_ticket(uuid, uuid, uuid, uuid) to authenticated, service_role;

create or replace function servicedesk.followers_after_delete()
returns trigger language plpgsql security definer set search_path = servicedesk, public as $$
begin
  if exists (select 1 from servicedesk.tickets where id = old.ticket_id) then
    insert into servicedesk.ticket_events (ticket_id, actor_id, kind, from_value)
    values (old.ticket_id, servicedesk.me(), 'follower_removed', servicedesk.employee_name(old.employee_id));
  end if;
  return old;
end $$;
create trigger followers_after_delete after delete on servicedesk.ticket_followers for each row execute function servicedesk.followers_after_delete();
