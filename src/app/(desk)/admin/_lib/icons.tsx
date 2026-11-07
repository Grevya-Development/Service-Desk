import { createElement } from "react";
import {
  AppWindow,
  BadgeCheck,
  Briefcase,
  Building2,
  Calendar,
  CreditCard,
  FileText,
  GraduationCap,
  Headphones,
  Headset,
  HeartHandshake,
  KeyRound,
  Laptop,
  LifeBuoy,
  Mail,
  Monitor,
  Package,
  Printer,
  ShieldCheck,
  Smartphone,
  UserPlus,
  Users,
  Wifi,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Icons a lead can pick for a catalog item (stored by name). */
export const CATALOG_ICONS: Record<string, LucideIcon> = {
  package: Package,
  laptop: Laptop,
  monitor: Monitor,
  "key-round": KeyRound,
  mail: Mail,
  wifi: Wifi,
  smartphone: Smartphone,
  headphones: Headphones,
  "file-text": FileText,
  "user-plus": UserPlus,
  "badge-check": BadgeCheck,
  briefcase: Briefcase,
  "building-2": Building2,
  calendar: Calendar,
  "credit-card": CreditCard,
  printer: Printer,
  "shield-check": ShieldCheck,
  software: AppWindow,
};

/** Icons an admin can pick for a team. */
export const TEAM_ICONS: Record<string, LucideIcon> = {
  "life-buoy": LifeBuoy,
  monitor: Monitor,
  users: Users,
  headset: Headset,
  wrench: Wrench,
  briefcase: Briefcase,
  "building-2": Building2,
  "credit-card": CreditCard,
  "shield-check": ShieldCheck,
  "graduation-cap": GraduationCap,
  "heart-handshake": HeartHandshake,
  laptop: Laptop,
};

export function iconFor(name: string | null | undefined, set: Record<string, LucideIcon> = CATALOG_ICONS): LucideIcon {
  return (name && (set[name] ?? CATALOG_ICONS[name] ?? TEAM_ICONS[name])) || Package;
}

/** Render an icon stored by name (falls back to a package icon). */
export function NamedIcon({ name, className, set }: { name: string | null | undefined; className?: string; set?: Record<string, LucideIcon> }) {
  return createElement(iconFor(name, set), { className, "aria-hidden": true });
}
