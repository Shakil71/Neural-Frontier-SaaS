/**
 * Permission catalog. Permissions are code-defined (not database rows) so that
 * authorization checks are type-safe and every grant is reviewable in source control.
 * Roles (built-in or tenant-defined) are sets of these keys.
 */
export const PERMISSIONS = {
  "tenant.read": "View tenant profile and settings",
  "tenant.manage": "Change tenant profile and settings",
  "identities.read": "View identities in the tenant",
  "identities.manage": "Suspend, reactivate and edit identities",
  "roles.read": "View roles and role assignments",
  "roles.assign": "Grant and revoke role assignments",
  "audit.read": "View the tenant audit log",
  "system.health.read": "View platform health and service status",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
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
    description: "Manages identities and settings. Cannot grant roles.",
    permissions: [
      "tenant.read",
      "tenant.manage",
      "identities.read",
      "identities.manage",
      "roles.read",
      "audit.read",
      "system.health.read",
    ],
  },
  security_auditor: {
    name: "Security Auditor",
    description: "Read-only access to identities, roles and the audit log.",
    permissions: ["tenant.read", "identities.read", "roles.read", "audit.read"],
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
