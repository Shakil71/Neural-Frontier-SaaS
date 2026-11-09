import type { PrismaClient } from "./generated/prisma/client.js";
import { syncBuiltInRoles } from "./roles.js";

export interface BootstrapInput {
  tenantName: string;
  tenantSlug: string;
  /** Email domain whose verified users belong to this tenant. The operator asserts ownership. */
  domain: string;
  ownerEmail: string;
  ownerName: string;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function validateBootstrapInput(input: BootstrapInput): BootstrapInput {
  const domain = input.domain.trim().toLowerCase();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!SLUG.test(input.tenantSlug))
    throw new Error("tenantSlug must be lowercase letters, digits and hyphens");
  if (!DOMAIN.test(domain)) throw new Error("domain is not a valid DNS name");
  if (!ownerEmail.endsWith(`@${domain}`))
    throw new Error("ownerEmail must belong to the tenant domain");
  if (!input.tenantName.trim() || !input.ownerName.trim())
    throw new Error("names must not be empty");
  return {
    ...input,
    domain,
    ownerEmail,
    tenantName: input.tenantName.trim(),
    ownerName: input.ownerName.trim(),
  };
}

/**
 * Idempotently provisions a tenant, its verified domain, the built-in roles and an
 * owner identity. The owner is linked to an OIDC subject on their first sign-in.
 */
export async function bootstrapTenant(db: PrismaClient, raw: BootstrapInput) {
  const input = validateBootstrapInput(raw);
  return db.$transaction(async (tx) => {
    const tenant = await tx.tenant.upsert({
      where: { slug: input.tenantSlug },
      create: { slug: input.tenantSlug, name: input.tenantName },
      update: {},
    });
    const tenantId = tenant.id;

    const existingDomain = await tx.tenantDomain.findUnique({
      where: { domain: input.domain, tenantId },
    });
    if (!existingDomain) {
      const claimed = await tx.tenantDomain.findFirst({
        where: { domain: input.domain, tenantId: { not: tenantId } },
      });
      if (claimed) throw new Error(`Domain ${input.domain} already belongs to another tenant`);
      await tx.tenantDomain.create({
        data: { tenantId, domain: input.domain, verifiedAt: new Date() },
      });
    }

    await syncBuiltInRoles(tx, tenantId);
    const ownerRole = await tx.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId, key: "owner" }, tenantId },
    });

    let owner = await tx.identity.findUnique({
      where: { tenantId_email: { tenantId, email: input.ownerEmail }, tenantId },
    });
    if (!owner) {
      owner = await tx.identity.create({
        data: { tenantId, email: input.ownerEmail, displayName: input.ownerName },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          action: "identity.provisioned",
          outcome: "success",
          actorLabel: "system:bootstrap",
          targetType: "identity",
          targetId: owner.id,
          targetLabel: owner.email,
          metadata: { via: "bootstrap", role: "owner" },
        },
      });
    }

    const assignment = await tx.roleAssignment.findUnique({
      where: { identityId_roleId: { identityId: owner.id, roleId: ownerRole.id }, tenantId },
    });
    if (!assignment) {
      await tx.roleAssignment.create({
        data: { tenantId, identityId: owner.id, roleId: ownerRole.id, reason: "Tenant bootstrap" },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          action: "role.assigned",
          outcome: "success",
          actorLabel: "system:bootstrap",
          targetType: "identity",
          targetId: owner.id,
          targetLabel: owner.email,
          metadata: { role: "owner", reason: "Tenant bootstrap" },
        },
      });
    }

    return { tenantId, ownerId: owner.id };
  });
}
