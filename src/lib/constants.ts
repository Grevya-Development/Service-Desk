import type { Tone } from "@/components/ui/badge";

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = ["new", "open", "pending", "resolved", "closed"] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN_STATUSES: Status[] = ["new", "open", "pending"];

export const PRIORITY_META: Record<Priority, { label: string; tone: Tone; hint: string; rank: number }> = {
  urgent: { label: "Urgent", tone: "red", hint: "Work has stopped for me or many people", rank: 0 },
  high: { label: "High", tone: "orange", hint: "I can't do an important part of my work", rank: 1 },
  medium: { label: "Medium", tone: "blue", hint: "Something is broken but there's a workaround", rank: 2 },
  low: { label: "Low", tone: "gray", hint: "A question or minor inconvenience", rank: 3 },
};

export const STATUS_META: Record<Status, { label: string; requesterLabel: string; tone: Tone }> = {
  new: { label: "New", requesterLabel: "Received", tone: "purple" },
  open: { label: "Open", requesterLabel: "In progress", tone: "blue" },
  pending: { label: "Pending", requesterLabel: "Waiting on you", tone: "yellow" },
  resolved: { label: "Resolved", requesterLabel: "Resolved", tone: "green" },
  closed: { label: "Closed", requesterLabel: "Closed", tone: "gray" },
};

export const APPROVAL_META: Record<string, { label: string; tone: Tone }> = {
  not_required: { label: "No approval needed", tone: "gray" },
  pending: { label: "Awaiting approval", tone: "yellow" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
};

export const APPROVAL_KINDS = { none: "No approval", manager: "Requester's manager", team_lead: "Team lead" } as const;
export type ApprovalKind = keyof typeof APPROVAL_KINDS;

export const ticketRef = (n: number | string) => `SD-${n}`;

export const ASSET_TYPES = {
  laptop: "Laptop",
  desktop: "Desktop",
  monitor: "Monitor",
  phone: "Phone",
  tablet: "Tablet",
  peripheral: "Peripheral",
  network: "Network device",
  software_license: "Software licence",
  other: "Other",
} as const;
export type AssetType = keyof typeof ASSET_TYPES;

export const ASSET_STATUSES: Record<string, { label: string; tone: Tone }> = {
  in_stock: { label: "In stock", tone: "teal" },
  assigned: { label: "Assigned", tone: "blue" },
  in_repair: { label: "In repair", tone: "orange" },
  retired: { label: "Retired", tone: "gray" },
  lost: { label: "Lost", tone: "red" },
};

/** Custom field types for service catalog forms. */
export const FIELD_TYPES = {
  text: "Short text",
  textarea: "Long text",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  checkbox: "Checkbox",
} as const;
export type FieldType = keyof typeof FIELD_TYPES;
export type CatalogField = { key: string; label: string; type: FieldType; required?: boolean; options?: string[]; help?: string };

/** Vercel caps request bodies at ~4.5 MB, so one message's files must stay under 4 MB in total. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

export function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
}
export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}
