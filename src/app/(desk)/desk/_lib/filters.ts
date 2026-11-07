import type { QueueParams, ViewKey } from "./queue";
import { cleanSearch, queueClock } from "./queue";

/** The subset of the PostgREST filter builder the queue uses. */
interface Filterable<Self> {
  in(column: string, values: readonly string[]): Self;
  eq(column: string, value: string | number | boolean): Self;
  neq(column: string, value: string): Self;
  is(column: string, value: null | boolean): Self;
  gte(column: string, value: string): Self;
  ilike(column: string, pattern: string): Self;
  or(filters: string): Self;
}

type Clock = ReturnType<typeof queueClock>;

/** Filters shared by every view: team scope + the filter bar. */
export function applyScope<Q extends Filterable<Q>>(query: Q, p: QueueParams, teamIds: string[]): Q {
  let q = query.in("team_id", p.team ? [p.team] : teamIds);
  if (p.priority) q = q.eq("priority", p.priority);
  if (p.category) q = q.eq("category_id", p.category);
  if (p.assignee === "unassigned") q = q.is("assignee_id", null);
  else if (p.assignee) q = q.eq("assignee_id", p.assignee);
  const s = cleanSearch(p.q);
  // A ticket number ("1042" / "SD-1042") jumps to that ticket; anything else searches subjects.
  // (Kept free of .or() so it never collides with the view's own .or() filter.)
  if (s.number !== null) q = q.eq("number", s.number);
  else if (s.text) q = q.ilike("subject", `%${s.text}%`);
  return q;
}

/** Filters that define each queue view. */
export function applyView<Q extends Filterable<Q>>(query: Q, view: ViewKey, meId: string, clock: Clock): Q {
  switch (view) {
    case "unassigned":
      return query.in("status", ["new", "open"]).is("assignee_id", null).neq("approval_status", "pending");
    case "mine":
      return query.eq("assignee_id", meId).in("status", ["new", "open", "pending"]);
    case "open":
      return query.in("status", ["new", "open", "pending"]);
    case "breaching":
      return query
        .in("status", ["new", "open"])
        .neq("approval_status", "pending")
        .or(
          `and(first_responded_at.is.null,first_response_due.lte."${clock.soon}"),resolution_due.lte."${clock.soon}",resolution_breached.is.true,and(first_responded_at.is.null,response_breached.is.true)`,
        );
    case "pending":
      return query.eq("status", "pending");
    case "approval":
      return query.eq("approval_status", "pending");
    case "resolved":
      return query.in("status", ["resolved", "closed"]).or(`resolved_at.gte."${clock.monthAgo}",and(resolved_at.is.null,updated_at.gte."${clock.monthAgo}")`);
  }
}
