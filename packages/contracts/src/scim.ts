import { z } from "zod";
import { IdSchema } from "./common.js";

/** A SCIM provisioning token as shown in the Admin Center (never the token itself). */
export const ScimTokenSchema = z.object({
  id: IdSchema,
  name: z.string(),
  hint: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type ScimToken = z.infer<typeof ScimTokenSchema>;

export const CreateScimTokenSchema = z.object({
  name: z.string().trim().min(2).max(120),
  lifetimeDays: z.number().int().min(1).max(730).default(365),
});
export type CreateScimToken = z.infer<typeof CreateScimTokenSchema>;

/** Returned once at creation. Only a hash is stored. */
export const IssuedScimTokenSchema = z.object({
  token: z.string(),
  scimToken: ScimTokenSchema,
  /** The SCIM base URL ("Tenant URL" in Entra ID) to configure at the provisioning client. */
  baseUrl: z.string(),
});
export type IssuedScimToken = z.infer<typeof IssuedScimTokenSchema>;

export const LogoutResponseSchema = z.object({
  /** When set, the browser continues to the identity provider to end its session there too. */
  redirectTo: z.string().nullable(),
});
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
