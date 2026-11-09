import type { Permission } from "@nf/contracts";

/**
 * The authenticated caller, resolved per request.
 * - `user`: a person, from the session cookie (sessionId = session row id).
 * - `service`: a service principal, from an OAuth bearer token (sessionId = token id,
 *   identityId = service principal id, email = "service:<name>" for audit labels).
 */
export interface Principal {
  kind: "user" | "service";
  sessionId: string;
  identityId: string;
  tenantId: string;
  email: string;
  displayName: string;
  permissions: ReadonlySet<Permission>;
  sessionExpiresAt: Date;
}

/** Request metadata recorded with audit events. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    principal?: Principal;
  }
}
