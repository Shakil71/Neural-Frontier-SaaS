import { BUILT_IN_ROLES } from "@nf/contracts";
import type { Prisma } from "./generated/prisma/client.js";

/**
 * Creates or updates the built-in roles for a tenant so that their permission sets
 * always match the code-defined catalog in @nf/contracts.
 */
export async function syncBuiltInRoles(tx: Prisma.TransactionClient, tenantId: string) {
  for (const [key, def] of Object.entries(BUILT_IN_ROLES)) {
    await tx.role.upsert({
      where: { tenantId_key: { tenantId, key }, tenantId },
      create: {
        tenantId,
        key,
        name: def.name,
        description: def.description,
        builtIn: true,
        permissions: [...def.permissions],
      },
      update: {
        name: def.name,
        description: def.description,
        builtIn: true,
        permissions: [...def.permissions],
        version: { increment: 1 },
      },
    });
  }
}
