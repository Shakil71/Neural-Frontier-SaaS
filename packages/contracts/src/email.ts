import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Outgoing email (Phase 3b): each organisation connects its own mail server (SMTP). Neural
 * Frontier's own SMTP client sends password resets and sign-in links; no external mail service.
 */

/** `tls`: TLS from the first byte (port 465). `starttls`: upgrade on 587/25. `none`: local relays only. */
export const SmtpSecuritySchema = z.enum(["starttls", "tls", "none"]);
export type SmtpSecurity = z.infer<typeof SmtpSecuritySchema>;

/** Ports a mail server may listen on. Any port is allowed only for a relay on this machine. */
export const SMTP_PORTS = [25, 465, 587, 2525] as const;

const NoLineBreaks = /^[^\r\n]*$/;
export const MailboxSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(NoLineBreaks)
  .pipe(z.email());

export const EmailSettingsSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  security: SmtpSecuritySchema,
  username: z.string().nullable(),
  /** Whether a password is stored (it is never returned), plus its last characters. */
  passwordHint: z.string().nullable(),
  fromAddress: z.string(),
  fromName: z.string(),
  enabled: z.boolean(),
  lastTest: z
    .object({ at: z.iso.datetime(), ok: z.boolean(), message: z.string().nullable() })
    .nullable(),
  updatedAt: z.iso.datetime(),
  version: z.number().int(),
});
export type EmailSettings = z.infer<typeof EmailSettingsSchema>;

export const EmailSettingsResponseSchema = z.object({ email: EmailSettingsSchema.nullable() });

export const UpsertEmailSettingsSchema = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+$|^\[?[0-9a-f:.]+\]?$/, "Enter a host name or IP address"),
  port: z.number().int().min(1).max(65535),
  security: SmtpSecuritySchema,
  username: z.string().trim().max(254).regex(NoLineBreaks).nullable(),
  /** Omit to keep the stored password; null removes it. */
  password: z.string().max(1024).nullable().optional(),
  fromAddress: MailboxSchema,
  fromName: z.string().trim().min(1).max(120).regex(NoLineBreaks),
  enabled: z.boolean(),
  version: z.number().int().nonnegative().optional(),
});
export type UpsertEmailSettings = z.infer<typeof UpsertEmailSettingsSchema>;

export const EmailTestResultSchema = z.object({
  ok: z.boolean(),
  /** The server's last reply, or what went wrong, in plain language. */
  message: z.string(),
  to: z.string(),
});
export type EmailTestResult = z.infer<typeof EmailTestResultSchema>;

export const EmailKindSchema = z.enum(["password_reset", "sign_in_link", "test"]);
export type EmailKind = z.infer<typeof EmailKindSchema>;

export const EmailDeliverySchema = z.object({
  id: IdSchema,
  kind: EmailKindSchema,
  to: z.string(),
  subject: z.string(),
  status: z.enum(["queued", "sent", "failed"]),
  attempts: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
});
export type EmailDelivery = z.infer<typeof EmailDeliverySchema>;
export const EmailDeliveryListSchema = z.object({ deliveries: z.array(EmailDeliverySchema) });

// ---------- Sessions ("Where you're signed in") ----------

export const SessionSummarySchema = z.object({
  id: IdSchema,
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** "local" (password), "global" or "tenant:<id>" (single sign-on), or null (older sessions). */
  signedInWith: z.string().nullable(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export const SessionListSchema = z.object({ sessions: z.array(SessionSummarySchema) });

export const RevokedCountSchema = z.object({ revoked: z.number().int() });

export const RequestPasswordResetSchema = z.object({ email: z.email().max(320) });
