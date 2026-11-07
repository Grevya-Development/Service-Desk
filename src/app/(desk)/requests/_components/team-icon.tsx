import { createElement } from "react";
import {
  Briefcase,
  Building2,
  Headphones,
  Laptop,
  LifeBuoy,
  Monitor,
  Shield,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

const TEAM_ICONS: Record<string, LucideIcon> = {
  monitor: Monitor,
  laptop: Laptop,
  users: Users,
  "life-buoy": LifeBuoy,
  wrench: Wrench,
  building: Building2,
  "building-2": Building2,
  shield: Shield,
  wallet: Wallet,
  briefcase: Briefcase,
  headphones: Headphones,
};

/** Lucide icon for a team's `icon` key (falls back to a life buoy). */
export function TeamIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  return createElement((icon && TEAM_ICONS[icon]) || LifeBuoy, { className, "aria-hidden": true });
}
