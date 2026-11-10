/**
 * Permission catalog. Permissions are code-defined (not database rows) so that
 * authorization checks are type-safe and every grant is reviewable in source control.
 * Roles (built-in or tenant-defined) are sets of these keys.
 */
export const PERMISSIONS = {
  "tenant.read": "View tenant profile and settings",
  "tenant.manage": "Change tenant profile and settings",
  "tenant.sso.manage": "Configure the tenant's own single sign-on provider",
  "identities.read": "View identities in the tenant",
  "identities.manage": "Suspend, reactivate and edit identities",
  "roles.read": "View roles and role assignments",
  "roles.assign": "Grant and revoke role assignments",
  "audit.read": "View the tenant audit log",
  "system.health.read": "View platform health and service status",
  "directory.read": "View users and groups synced from external directories",
  "connectors.read": "View directory connectors and their sync history",
  "connectors.manage": "Create, change and delete directory connectors",
  "connectors.sync": "Start a directory sync",
  "service_principals.read": "View service principals (machine identities)",
  "service_principals.manage": "Create service principals and issue or revoke their secrets",
  "servers.read": "View Linux servers and their inventory",
  "servers.manage": "Enrol and retire servers and manage agent enrollment keys",
  "applications.read": "View applications that sign people in with Neural Frontier",
  "applications.manage": "Register applications, manage their secrets and who may use them",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/**
 * Permissions a service principal may hold. Deliberately excludes anything that changes who
 * can do what (roles, identities, tenant settings, other service principals, connector
 * credentials): automation can read and trigger syncs, never escalate.
 */
export const MACHINE_PERMISSIONS = [
  "tenant.read",
  "identities.read",
  "roles.read",
  "audit.read",
  "system.health.read",
  "directory.read",
  "connectors.read",
  "connectors.sync",
  "servers.read",
] as const satisfies readonly Permission[];

export type MachinePermission = (typeof MACHINE_PERMISSIONS)[number];

export function isMachinePermission(value: string): value is MachinePermission {
  return (MACHINE_PERMISSIONS as readonly string[]).includes(value);
}

/** Built-in roles provisioned for every tenant. Keys are stable identifiers. */
export const BUILT_IN_ROLES = {
  owner: {
    name: "Tenant Owner",
    description: "Full control of the tenant, including role assignment.",
    permissions: ALL_PERMISSIONS,
  },
  administrator: {
    name: "Administrator",
    description: "Manages identities, connectors and settings. Cannot grant roles.",
    permissions: [
      "tenant.read",
      "tenant.manage",
      "identities.read",
      "identities.manage",
      "roles.read",
      "audit.read",
      "system.health.read",
      "directory.read",
      "connectors.read",
      "connectors.manage",
      "connectors.sync",
      "service_principals.read",
      "servers.read",
      "servers.manage",
      "applications.read",
      "applications.manage",
    ],
  },
  security_auditor: {
    name: "Security Auditor",
    description: "Read-only access to identities, roles, directory data and the audit log.",
    permissions: [
      "tenant.read",
      "identities.read",
      "roles.read",
      "audit.read",
      "directory.read",
      "connectors.read",
      "service_principals.read",
      "servers.read",
      "applications.read",
    ],
  },
  member: {
    name: "Member",
    description: "Signed-in user with no administrative access.",
    permissions: [],
  },
} as const satisfies Record<
  string,
  { name: string; description: string; permissions: readonly Permission[] }
>;

export type BuiltInRoleKey = keyof typeof BUILT_IN_ROLES;
