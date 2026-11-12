/** Sidebar navigation. Built per viewer from their desk roles. */
export type NavIcon =
  | "home"
  | "plus"
  | "catalog"
  | "requests"
  | "kb"
  | "laptop"
  | "approvals"
  | "queue"
  | "ticket-plus"
  | "kb-edit"
  | "assets"
  | "reports"
  | "teams"
  | "categories"
  | "sla"
  | "catalog-admin"
  | "settings"
  | "status"
  | "incidents"
  | "templates"
  | "overview";

export type NavItem = { label: string; href: string; icon: NavIcon; badge?: number; exact?: boolean };
export type NavSection = { title: string; items: NavItem[] };

export type NavViewer = { isAgent: boolean; isLead: boolean; isAdmin: boolean; managesAssets: boolean; showApprovals: boolean };

export function buildNav(v: NavViewer, counts: { approvals: number; unassigned: number; activeIncidents: number; myTeamIncidents: number }): NavSection[] {
  const sections: NavSection[] = [
    {
      title: "Help center",
      items: [
        { label: "Home", href: "/home", icon: "home" },
        { label: "Report an issue", href: "/requests/new", icon: "plus" },
        { label: "Request a service", href: "/catalog", icon: "catalog" },
        { label: "My requests", href: "/requests", icon: "requests", exact: true },
        { label: "Knowledge base", href: "/kb", icon: "kb" },
        { label: "My assets", href: "/assets/mine", icon: "laptop" },
        { label: "Service status", href: "/status", icon: "status", badge: counts.activeIncidents },
        ...(v.showApprovals || counts.approvals > 0 ? [{ label: "Approvals", href: "/approvals", icon: "approvals" as const, badge: counts.approvals }] : []),
      ],
    },
  ];
  if (v.isAgent) {
    sections.push({
      title: "Agent workspace",
      items: [
        { label: "Ticket queue", href: "/desk", icon: "queue", badge: counts.unassigned, exact: true },
        { label: "New ticket", href: "/desk/new", icon: "ticket-plus" },
        { label: "Incidents", href: "/desk/incidents", icon: "incidents", badge: counts.myTeamIncidents },
        { label: "Reply templates", href: "/desk/templates", icon: "templates" },
        { label: "Manage articles", href: "/desk/kb", icon: "kb-edit" },
        ...(v.managesAssets ? [{ label: "Assets", href: "/desk/assets", icon: "assets" as const }] : []),
        { label: "Reports", href: "/desk/reports", icon: "reports" },
      ],
    });
  }
  if (v.isLead) {
    sections.push({
      title: "Administration",
      items: [
        { label: "Teams & agents", href: "/admin/teams", icon: "teams" },
        { label: "Categories", href: "/admin/categories", icon: "categories" },
        { label: "SLA targets", href: "/admin/sla", icon: "sla" },
        { label: "Service catalog", href: "/admin/catalog", icon: "catalog-admin" },
        ...(v.isAdmin ? [{ label: "Settings", href: "/admin/settings", icon: "settings" as const }] : []),
      ],
    });
  }
  return sections;
}

/**
 * Desk admins in the admin console see only console pages: no help-center items. Their own
 * requests are one switch away ("Switch to my requests" in the account menu).
 */
export function buildAdminNav(counts: { approvals: number; unassigned: number; activeIncidents: number }): NavSection[] {
  return [
    {
      title: "Dashboard",
      items: [{ label: "Overview", href: "/admin", icon: "overview", exact: true }],
    },
    {
      title: "Operations",
      items: [
        { label: "Ticket queue", href: "/desk", icon: "queue", badge: counts.unassigned, exact: true },
        { label: "New ticket", href: "/desk/new", icon: "ticket-plus" },
        { label: "Approvals", href: "/approvals", icon: "approvals", badge: counts.approvals },
        { label: "Incidents", href: "/desk/incidents", icon: "incidents", badge: counts.activeIncidents },
        { label: "Assets", href: "/desk/assets", icon: "assets" },
        { label: "Reply templates", href: "/desk/templates", icon: "templates" },
        { label: "Manage articles", href: "/desk/kb", icon: "kb-edit" },
        { label: "Reports", href: "/desk/reports", icon: "reports" },
      ],
    },
    {
      title: "Configuration",
      items: [
        { label: "Teams & agents", href: "/admin/teams", icon: "teams" },
        { label: "Categories", href: "/admin/categories", icon: "categories" },
        { label: "SLA targets", href: "/admin/sla", icon: "sla" },
        { label: "Service catalog", href: "/admin/catalog", icon: "catalog-admin" },
        { label: "Settings", href: "/admin/settings", icon: "settings" },
      ],
    },
  ];
}
