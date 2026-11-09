import { BUILT_IN_ROLES } from "@nf/contracts";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";

function samePermissions(stored: unknown, wanted: readonly string[]) {
  if (!Array.isArray(stored) || stored.length !== wanted.length) return false;
  const set = new Set(stored);
  return wanted.every((p) => set.has(p));
}

/**
 * Creates or updates the built-in roles for a tenant so that their permission sets
 * always match the code-defined catalog in @nf/contracts. Rows that already match are left
 * untouched, so running this on every start-up does not churn `version`.
 */
export async function syncBuiltInRoles(tx: Prisma.TransactionClient, tenantId: string) {
  let changed = 0;
  for (const [key, def] of Object.entries(BUILT_IN_ROLES)) {
    const existing = await tx.role.findUnique({
      where: { tenantId_key: { tenantId, key }, tenantId },
    });
    if (!existing) {
      await tx.role.create({
        data: {
          tenantId,
          key,
          name: def.name,
          description: def.description,
          builtIn: true,
          permissions: [...def.permissions],
        },
      });
      changed++;
      continue;
    }
    if (
      existing.name === def.name &&
      existing.description === def.description &&
      existing.builtIn &&
      samePermissions(existing.permissions, def.permissions)
    ) {
      continue;
    }
    await tx.role.update({
      where: { id: existing.id, tenantId },
      data: {
        name: def.name,
        description: def.description,
        builtIn: true,
        permissions: [...def.permissions],
        version: { increment: 1 },
      },
    });
    changed++;
  }
  return changed;
}

/** Brings every tenant's built-in roles up to date (run at API start-up after a release). */
export async function syncBuiltInRolesForAllTenants(db: PrismaClient): Promise<number> {
  const tenants = await db.tenant.findMany({ select: { id: true } });
  let changed = 0;
  for (const t of tenants) {
    changed += await db.$transaction((tx) => syncBuiltInRoles(tx, t.id));
  }
  return changed;
}
