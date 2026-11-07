/** Approval rows with the ticket context approvers need. */
export const APPROVAL_SELECT = `id, kind, status, comment, created_at, decided_at,
  team:teams(name, color),
  ticket:tickets(id, number, subject, description, form_data, priority, status, created_at, requester_id,
    requester:people!requester_id(id, full_name, avatar_url, designation, department),
    catalog_item:catalog_items(name, icon, fields),
    team:teams(name, color))`;

export type ApprovalRow = {
  id: string;
  kind: string;
  status: string;
  comment: string | null;
  created_at: string;
  decided_at: string | null;
  team: { name: string; color: string } | null;
  ticket: {
    id: string;
    number: number;
    subject: string;
    description: string;
    form_data: unknown;
    priority: string;
    status: string;
    created_at: string;
    requester_id: string;
    requester: { id: string; full_name: string | null; avatar_url: string | null; designation: string | null; department: string | null } | null;
    catalog_item: { name: string; icon: string; fields: unknown } | null;
    team: { name: string; color: string } | null;
  } | null;
};

export type ApprovalWithTicket = ApprovalRow & { ticket: NonNullable<ApprovalRow["ticket"]> };
