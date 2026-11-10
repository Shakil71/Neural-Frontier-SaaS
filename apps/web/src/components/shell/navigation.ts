import type { Permission } from "@nf/contracts";
import {
  Activity,
  AppWindow,
  BookUser,
  Bot,
  Building2,
  Cable,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  Server,
  ShieldAlert,
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
      {
        href: "/applications",
        label: "Applications",
        icon: AppWindow,
        permission: "applications.read",
        keywords:
          "oidc openid connect single sign-on sso apps clients sign in with neural frontier",
      },
    ],
  },
  {
    group: "Directory",
    items: [
      {
        href: "/directory",
        label: "Directory",
        icon: BookUser,
        permission: "directory.read",
        keywords: "entra azure ad users groups members synced",
      },
      {
        href: "/connectors",
        label: "Connectors",
        icon: Cable,
        permission: "connectors.read",
        keywords: "microsoft graph entra sync integration",
      },
    ],
  },
  {
    group: "Infrastructure",
    items: [
      {
        href: "/servers",
        label: "Servers",
        icon: Server,
        permission: "servers.read",
        keywords: "linux hosts machines agent inventory packages",
      },
      {
        href: "/exposure",
        label: "Exposure",
        icon: ShieldAlert,
        permission: "servers.read",
        keywords: "security findings firewall ports ssh open network risk",
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
        href: "/service-principals",
        label: "Service principals",
        icon: Bot,
        permission: "service_principals.read",
        keywords: "machine identity api client credentials automation tokens",
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
