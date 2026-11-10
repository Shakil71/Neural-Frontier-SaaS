import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Applications (Phase 3c): other apps sign people in with their Neural Frontier account through
 * OpenID Connect. Neural Frontier is the provider; each tenant registers its own applications.
 */

/** `web`: has a back end that keeps a secret. `spa` / `native`: public clients (PKCE only). */
export const ApplicationTypeSchema = z.enum(["web", "spa", "native"]);
export type ApplicationType = z.infer<typeof ApplicationTypeSchema>;

export const OIDC_SCOPES = ["openid", "profile", "email", "roles"] as const;

/**
 * Redirect URIs must be absolute, without a fragment, and https, except for loopback
 * addresses (local development) and custom schemes for native apps (`com.example.app:/cb`).
 */
export const RedirectUriSchema = z
  .string()
  .trim()
  .max(1024)
  .refine((v) => {
    // No fragment, whitespace or control characters anywhere.
    if (/[#\s\u0000-\u001f\u007f]/.test(v)) return false;
    // https:// with a host name (no user info).
    if (/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:[/?]\S*)?$/i.test(v)) return true;
    // http:// only for loopback (local development).
    if (/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?]\S*)?$/i.test(v))
      return true;
    // Native apps: a reverse-DNS custom scheme (RFC 8252 §7.1), e.g. com.example.app:/callback.
    return /^[a-z][a-z0-9+-]*(?:\.[a-z0-9+-]+)+:\/[^/]\S*$/i.test(v);
  }, "Use an https:// address (http:// only for localhost), without a #fragment");

export const ApplicationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string(),
  type: ApplicationTypeSchema,
  clientId: z.string(),
  /** Confidential (web) clients only; the secret itself is shown once. */
  secretHint: z.string().nullable(),
  redirectUris: z.array(z.string()),
  postLogoutRedirectUris: z.array(z.string()),
  /** Null: everyone active in the organisation. Otherwise people holding one of these roles. */
  allowedRoleIds: z.array(IdSchema).nullable(),
  enabled: z.boolean(),
  lastUsedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.number().int(),
});
export type Application = z.infer<typeof ApplicationSchema>;
export const ApplicationListSchema = z.object({
  applications: z.array(ApplicationSchema),
  /** Endpoints to configure in the application. */
  issuer: z.string(),
  discoveryUrl: z.string(),
});

const ApplicationFields = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(""),
  redirectUris: z.array(RedirectUriSchema).min(1).max(20),
  postLogoutRedirectUris: z.array(RedirectUriSchema).max(20).default([]),
  allowedRoleIds: z.array(IdSchema).max(50).nullable().default(null),
  enabled: z.boolean().default(true),
};

export const CreateApplicationSchema = z.object({
  type: ApplicationTypeSchema,
  ...ApplicationFields,
});
export type CreateApplication = z.infer<typeof CreateApplicationSchema>;

export const UpdateApplicationSchema = z.object({
  ...ApplicationFields,
  version: z.number().int().nonnegative(),
});
export type UpdateApplication = z.infer<typeof UpdateApplicationSchema>;

/** Returned once, when a web application is created or its secret is replaced. */
export const IssuedApplicationSchema = z.object({
  application: ApplicationSchema,
  clientSecret: z.string().nullable(),
});
export type IssuedApplication = z.infer<typeof IssuedApplicationSchema>;
