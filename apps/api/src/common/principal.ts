import type { Permission } from "@nf/contracts";

/** The authenticated caller, resolved per request from the session cookie. */
export interface Principal {
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
