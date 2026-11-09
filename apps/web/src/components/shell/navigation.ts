import type { Permission } from "@nf/contracts";
import {
  Activity,
  Building2,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hidden from navigation unless the user holds this permission. */
  permission: Permission;
  keywords?: string;
}

/** Only modules that are actually built appear here. Planned modules live in docs/product. */
export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Overview",
    items: [
      {
        href: "/",
        label: "Overview",
        icon: LayoutDashboard,
        permission: "identities.read",
        keywords: "dashboard home",
      },
    ],
  },
  {
    group: "Identity",
    items: [
      {
        href: "/identities",
        label: "Identities",
        icon: Users,
        permission: "identities.read",
        keywords: "users people accounts",
      },
      {
        href: "/roles",
        label: "Roles & access",
        icon: ShieldCheck,
        permission: "roles.read",
        keywords: "rbac permissions",
      },
    ],
  },
  {
    group: "Governance",
    items: [
      {
        href: "/audit",
        label: "Audit log",
        icon: ScrollText,
        permission: "audit.read",
        keywords: "events history security",
      },
    ],
  },
  {
    group: "Platform",
    items: [
      {
        href: "/system",
        label: "System health",
        icon: Activity,
        permission: "system.health.read",
        keywords: "status uptime",
      },
      {
        href: "/settings",
        label: "Organisation",
        icon: Building2,
        permission: "tenant.read",
        keywords: "tenant settings domains sso",
      },
    ],
  },
];
