-- Auto-assign: agents first (fewest open tickets), team leads only when no agent is available.
create or replace function servicedesk.pick_assignee(p_team uuid)
returns uuid language sql stable security definer set search_path = servicedesk, public as $$
  select m.employee_id
  from servicedesk.team_members m
  join public.employees e on e.id = m.employee_id and e.status <> 'exited'
  left join servicedesk.tickets t on t.assignee_id = m.employee_id and t.status in ('new','open','pending')
  where m.team_id = p_team
  group by m.employee_id, m.role, m.created_at
  order by (m.role = 'lead'), count(t.id), m.created_at
  limit 1
$$;

-- An asset marked "assigned" must have a holder.
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
  if new.assigned_to is not null and new.status in ('in_stock','retired','lost') then
    new.assigned_to := null;
  end if;
  if new.status = 'assigned' and new.assigned_to is null then
    raise exception 'Choose who has this asset';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Article search: all words (default, for the knowledge base) or any word (suggestions while typing).
drop function if exists servicedesk.search_articles(text, int);
create or replace function servicedesk.search_articles(q text, lim int default 8, any_term boolean default false)
returns setof servicedesk.kb_articles language plpgsql stable set search_path = servicedesk, public as $$
declare
  tsq tsquery;
  terms text;
begin
  select string_agg(quote_literal(w) || ':*', case when any_term then ' | ' else ' & ' end) into terms
  from regexp_split_to_table(lower(regexp_replace(coalesce(q, ''), '[^[:alnum:] ]', ' ', 'g')), '\s+') w
  where length(w) > 2 or (not any_term and length(w) > 1);
  if terms is null then return; end if;
  tsq := to_tsquery('english', terms);
  return query
    select a.* from servicedesk.kb_articles a
    where a.status = 'published' and a.search @@ tsq
    order by ts_rank(a.search, tsq) desc, a.view_count desc
    limit least(greatest(coalesce(lim, 8), 1), 50);
end $$;
revoke execute on function servicedesk.search_articles(text, int, boolean) from public, anon;
grant execute on function servicedesk.search_articles(text, int, boolean) to authenticated, service_role;
