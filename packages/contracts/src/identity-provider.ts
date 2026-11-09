import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Per-tenant OpenID Connect provider (Phase 2b).
 * - `optional`: people can use the tenant's IdP or the deployment-wide one.
 * - `required`: only the tenant's IdP is accepted for this tenant.
 */
export const IdpEnforcementSchema = z.enum(["optional", "required"]);
export type IdpEnforcement = z.infer<typeof IdpEnforcementSchema>;

export const TenantIdentityProviderSchema = z.object({
  id: IdSchema,
  issuer: z.string(),
  clientId: z.string(),
  secretHint: z.string(),
  requireEmailVerified: z.boolean(),
  enforcement: IdpEnforcementSchema,
  /** The redirect URI to register at the IdP. */
  redirectUri: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.number().int(),
});
export type TenantIdentityProvider = z.infer<typeof TenantIdentityProviderSchema>;

export const IssuerUrlSchema = z
  .url()
  .max(512)
  .refine((v) => !/[?#]/.test(v), "The issuer URL must not contain a query or fragment");

export const UpsertIdentityProviderSchema = z.object({
  issuer: IssuerUrlSchema,
  clientId: z.string().trim().min(1).max(255),
  /** Required when creating; omit to keep the stored secret on update. */
  clientSecret: z.string().min(1).max(1024).optional(),
  requireEmailVerified: z.boolean().default(true),
  /** Optimistic concurrency when updating an existing configuration. */
  version: z.number().int().nonnegative().optional(),
});
export type UpsertIdentityProvider = z.infer<typeof UpsertIdentityProviderSchema>;

export const SetIdpEnforcementSchema = z.object({
  enforcement: IdpEnforcementSchema,
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(500),
});
export type SetIdpEnforcement = z.infer<typeof SetIdpEnforcementSchema>;
