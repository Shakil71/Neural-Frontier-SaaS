import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { VerifiedClaims } from "./oidc.service.js";

export type SignInRejection =
  | "email_missing"
  | "email_unverified"
  | "unknown_domain"
  | "not_provisioned"
  | "identity_suspended"
  | "tenant_suspended"
  | "subject_mismatch";

export type SignInResult =
  | { ok: true; tenantId: string; identityId: string }
  | { ok: false; reason: SignInRejection; tenantId: string | null };

/**
 * Maps verified IdP claims to a tenant identity.
 * 1. A known (issuer, subject) pair always wins — email changes at the IdP cannot hijack accounts.
 * 2. Otherwise the verified email's domain selects the tenant; a pre-provisioned identity with that
 *    email is linked on first sign-in, or a new Member identity is created if auto-provisioning is on.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async signIn(claims: VerifiedClaims, meta: RequestMeta): Promise<SignInResult> {
    const result = await this.resolve(claims, meta);
    if (!result.ok) {
      await this.audit.record({
        tenantId: result.tenantId,
        action: "auth.sign_in_failed",
        outcome: "failure",
        actor: { id: null, label: claims.email || `${claims.issuer}#${claims.subject}` },
        meta,
        metadata: { reason: result.reason, issuer: claims.issuer },
      });
    }
    return result;
  }

  private async resolve(claims: VerifiedClaims, meta: RequestMeta): Promise<SignInResult> {
    const sys = this.database.system;

    const bound = await sys.identity.findUnique({
      where: { oidcIssuer_oidcSubject: { oidcIssuer: claims.issuer, oidcSubject: claims.subject } },
      include: { tenant: true },
    });
    if (bound)
      return this.finish(bound.tenantId, bound.id, bound.status, bound.tenant.status, claims, meta);

    if (!claims.email) return { ok: false, reason: "email_missing", tenantId: null };
    // Secure default: required unless an operator explicitly disabled it for their IdP.
    if ((this.config.oidc?.requireEmailVerified ?? true) && !claims.emailVerified)
      return { ok: false, reason: "email_unverified", tenantId: null };

    const domain = claims.email.split("@")[1] ?? "";
    // Cross-tenant by definition: the domain is what selects the tenant.
    const tenantDomain = await sys.tenantDomain.findUnique({
      where: { domain },
      include: { tenant: true },
    });
    if (!tenantDomain?.verifiedAt) return { ok: false, reason: "unknown_domain", tenantId: null };
    const tenantId = tenantDomain.tenantId;
    if (tenantDomain.tenant.status !== "active")
      return { ok: false, reason: "tenant_suspended", tenantId };

    const db = this.database.db;
    const existing = await db.identity.findUnique({
      where: { tenantId_email: { tenantId, email: claims.email }, tenantId },
    });
    if (existing) {
      // Already linked to a different IdP account: refuse rather than re-link silently.
      if (existing.oidcSubject) return { ok: false, reason: "subject_mismatch", tenantId };
      await db.identity.update({
        where: { id: existing.id, tenantId },
        data: { oidcIssuer: claims.issuer, oidcSubject: claims.subject, version: { increment: 1 } },
      });
      return this.finish(tenantId, existing.id, existing.status, "active", claims, meta);
    }

    if (!this.config.autoProvision) return { ok: false, reason: "not_provisioned", tenantId };

    const identityId = await this.database.db.$transaction(async (tx) => {
      const member = await tx.role.findUniqueOrThrow({
        where: { tenantId_key: { tenantId, key: "member" }, tenantId },
      });
      const created = await tx.identity.create({
        data: {
          tenantId,
          email: claims.email,
          displayName: claims.name?.trim() || claims.email,
          oidcIssuer: claims.issuer,
          oidcSubject: claims.subject,
        },
      });
      await tx.roleAssignment.create({
        data: {
          tenantId,
          identityId: created.id,
          roleId: member.id,
          reason: "Automatic provisioning on first sign-in",
        },
      });
      await this.audit.record(
        {
          tenantId,
          action: "identity.provisioned",
          outcome: "success",
          actor: { id: null, label: "system:sso" },
          target: { type: "identity", id: created.id, label: created.email },
          meta,
          metadata: { via: "oidc", role: "member" },
        },
        tx,
      );
      return created.id;
    });
    return this.finish(tenantId, identityId, "active", "active", claims, meta);
  }

  private async finish(
    tenantId: string,
    identityId: string,
    identityStatus: string,
    tenantStatus: string,
    claims: VerifiedClaims,
    meta: RequestMeta,
  ): Promise<SignInResult> {
    if (tenantStatus !== "active") return { ok: false, reason: "tenant_suspended", tenantId };
    if (identityStatus !== "active") return { ok: false, reason: "identity_suspended", tenantId };
    await this.database.db.identity.update({
      where: { id: identityId, tenantId },
      data: { lastSignInAt: new Date() },
    });
    await this.audit.record({
      tenantId,
      action: "auth.sign_in",
      outcome: "success",
      actor: { id: identityId, label: claims.email },
      meta,
      metadata: { issuer: claims.issuer },
    });
    return { ok: true, tenantId, identityId };
  }
}
