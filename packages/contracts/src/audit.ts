import { z } from "zod";
import { IdSchema } from "./common.js";

/** Stable audit action identifiers. Add new actions here; never rename existing ones. */
export const AUDIT_ACTIONS = [
  "auth.sign_in",
  "auth.sign_in_failed",
  "auth.sign_out",
  "identity.provisioned",
  "identity.status_changed",
  "role.assigned",
  "role.revoked",
  "authz.denied",
  "connector.created",
  "connector.updated",
  "connector.deleted",
  "connector.sync_requested",
  "connector.sync_completed",
  "connector.sync_failed",
  "service_principal.created",
  "service_principal.updated",
  "service_principal.secret_created",
  "service_principal.secret_revoked",
  "service_principal.token_issued",
  "service_principal.auth_failed",
  "tenant.idp_configured",
  "tenant.idp_removed",
  "tenant.idp_enforcement_changed",
  "scim.token_created",
  "scim.token_revoked",
] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditOutcomeSchema = z.enum(["success", "failure", "denied"]);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AuditEventSchema = z.object({
  id: IdSchema,
  occurredAt: z.iso.datetime(),
  action: AuditActionSchema,
  outcome: AuditOutcomeSchema,
  actor: z.object({ id: IdSchema.nullable(), label: z.string() }),
  target: z.object({ type: z.string(), id: z.string(), label: z.string().nullable() }).nullable(),
  ipAddress: z.string().nullable(),
  requestId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditQuerySchema = z.object({
  cursor: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: AuditActionSchema.optional(),
  outcome: AuditOutcomeSchema.optional(),
  actorId: IdSchema.optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
