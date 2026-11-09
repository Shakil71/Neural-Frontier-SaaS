import type { ScopedTransaction } from "@nf/db";
import { Errors } from "../../common/errors.js";

/**
 * Invariant: every tenant keeps at least one active Tenant Owner, so it can never lock
 * itself out. Call inside the transaction that would suspend an owner or revoke an owner role.
 */
export async function assertNotLastOwner(
  tx: ScopedTransaction,
  tenantId: string,
  change: { identityId: string; roleId?: string },
) {
  const owner = await tx.role.findUnique({
    where: { tenantId_key: { tenantId, key: "owner" }, tenantId },
  });
  if (!owner) return;
  if (change.roleId && change.roleId !== owner.id) return;

  // Lock the owner assignments for the duration of the transaction so two concurrent
  // removals cannot both see "one other owner left".
  const owners = await tx.$queryRaw<{ identityId: string }[]>`
    SELECT ra.identityId FROM role_assignments ra
    JOIN identities i ON i.id = ra.identityId AND i.tenantId = ra.tenantId
    WHERE ra.tenantId = ${tenantId} AND ra.roleId = ${owner.id} AND i.status = 'active'
    FOR UPDATE`;
  const isOwner = owners.some((o) => o.identityId === change.identityId);
  if (isOwner && owners.length <= 1) {
    throw Errors.conflict("A tenant must keep at least one active Tenant Owner");
  }
}
