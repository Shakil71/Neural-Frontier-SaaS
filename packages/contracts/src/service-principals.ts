import { z } from "zod";
import { IdSchema } from "./common.js";
import { MACHINE_PERMISSIONS } from "./permissions.js";

export const MachinePermissionSchema = z.enum(MACHINE_PERMISSIONS);

export const ServicePrincipalSecretSchema = z.object({
  id: IdSchema,
  hint: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type ServicePrincipalSecret = z.infer<typeof ServicePrincipalSecretSchema>;

export const ServicePrincipalSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string(),
  clientId: z.string(),
  permissions: z.array(MachinePermissionSchema),
  status: z.enum(["active", "disabled"]),
  lastUsedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  secrets: z.array(ServicePrincipalSecretSchema),
  version: z.number().int(),
});
export type ServicePrincipal = z.infer<typeof ServicePrincipalSchema>;

export const SecretLifetimeSchema = z.number().int().min(1).max(730);

export const CreateServicePrincipalSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(""),
  permissions: z.array(MachinePermissionSchema).min(1),
  secretLifetimeDays: SecretLifetimeSchema.default(180),
});
export type CreateServicePrincipal = z.infer<typeof CreateServicePrincipalSchema>;

export const UpdateServicePrincipalSchema = z.object({
  version: z.number().int().nonnegative(),
  status: z.enum(["active", "disabled"]).optional(),
  permissions: z.array(MachinePermissionSchema).min(1).optional(),
  reason: z.string().trim().min(3).max(500),
});
export type UpdateServicePrincipal = z.infer<typeof UpdateServicePrincipalSchema>;

export const CreateSecretSchema = z.object({
  secretLifetimeDays: SecretLifetimeSchema.default(180),
});

/** Returned exactly once, when a secret is created. The secret is not stored and can't be shown again. */
export const IssuedSecretSchema = z.object({
  servicePrincipal: ServicePrincipalSchema,
  clientId: z.string(),
  clientSecret: z.string(),
  secretId: IdSchema,
  expiresAt: z.iso.datetime(),
});
export type IssuedSecret = z.infer<typeof IssuedSecretSchema>;

/** RFC 6749 §4.4 client credentials request (form or JSON body). */
export const TokenRequestSchema = z.object({
  grant_type: z.literal("client_credentials"),
  client_id: z.string().min(1).max(64),
  client_secret: z.string().min(1).max(256),
  /** Space-separated subset of the principal's permissions. Omit for all of them. */
  scope: z.string().max(1000).optional(),
});

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int(),
  scope: z.string(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
