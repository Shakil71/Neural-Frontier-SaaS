import { Injectable } from "@nestjs/common";
import { isPermission, type Permission } from "@nf/contracts";
import { DatabaseService } from "../../infra/database.service.js";

/**
 * The single place where "what may this identity do" is decided.
 * Permissions are resolved from role assignments on every request, so a revoked role
 * takes effect immediately (no stale token claims).
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly database: DatabaseService) {}

  async permissionsFor(tenantId: string, identityId: string): Promise<Set<Permission>> {
    const assignments = await this.database.db.roleAssignment.findMany({
      where: { tenantId, identityId },
      select: { role: { select: { permissions: true } } },
    });
    return collectPermissions(assignments.map((a) => a.role.permissions));
  }
}

/** Union of role permission arrays, dropping anything not in the code-defined catalog. */
export function collectPermissions(rolePermissionLists: unknown[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const list of rolePermissionLists) {
    if (!Array.isArray(list)) continue;
    for (const p of list) if (typeof p === "string" && isPermission(p)) out.add(p);
  }
  return out;
}
