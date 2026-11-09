import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { ProviderContext, VerifiedClaims } from "./oidc.service.js";

export type SignInRejection =
  | "email_missing"
  | "email_unverified"
  | "unknown_domain"
  | "not_provisioned"
  | "identity_suspended"
  | "tenant_suspended"
  | "subject_mismatch"
  | "idp_tenant_mismatch"
  | "tenant_idp_required";

export type SignInResult =
  | { ok: true; tenantId: string; identityId: string }
  | { ok: false; reason: SignInRejection; tenantId: string | null };

/** Sign-ins before per-tenant providers existed: the deployment-wide provider. */
export const GLOBAL_PROVIDER = (requireEmailVerified: boolean): ProviderContext => ({
  key: "global",
  tenantId: null,
  requireEmailVerified,
});

/**
 * Maps verified IdP claims to a tenant identity.
 * 1. A known (issuer, subject) pair always wins — email changes at the IdP cannot hijack accounts.
 * 2. Otherwise the verified email's domain selects the tenant; a pre-provisioned identity with that
 *    email is linked on first sign-in, or a new Member identity is created if auto-provisioning is on.
 *
 * Per-tenant providers (Phase 2b) add three rules:
 * - A tenant's provider can only sign people in to that tenant (`idp_tenant_mismatch`), whatever
 *   email it asserts. This stops one tenant's IdP from vouching for another tenant's users.
 * - When a tenant requires its own provider, the deployment-wide one is refused for that tenant
 *   (`tenant_idp_required`).
 * - Moving a tenant to its own provider: an identity bound to a *different issuer* is re-bound on
 *   its first sign-in through the tenant's provider (audited). The tenant owner chose to trust that
 *   provider for their verified domain. The same issuer with a different subject is still refused.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async signIn(
    claims: VerifiedClaims,
    meta: RequestMeta,
    provider: ProviderContext = GLOBAL_PROVIDER(this.config.oidc?.requireEmailVerified ?? true),
  ): Promise<SignInResult> {
    const result = await this.resolve(claims, meta, provider);
    if (!result.ok) {
      await this.audit.record({
        tenantId: result.tenantId,
        action: "auth.sign_in_failed",
        outcome: "failure",
        actor: { id: null, label: claims.email || `${claims.issuer}#${claims.subject}` },
        meta,
        metadata: { reason: result.reason, issuer: claims.issuer, provider: provider.key },
      });
    }
    return result;
  }

  /** Whether `tenantId` refuses sign-ins that came through `provider`. */
  private async refusedByPolicy(
    tenantId: string,
    provider: ProviderContext,
  ): Promise<SignInRejection | null> {
    if (provider.tenantId) return provider.tenantId === tenantId ? null : "idp_tenant_mismatch";
    const idp = await this.database.db.tenantIdentityProvider.findUnique({
      where: { tenantId },
      select: { enforcement: true },
    });
    return idp?.enforcement === "required" ? "tenant_idp_required" : null;
  }

  private async resolve(
    claims: VerifiedClaims,
    meta: RequestMeta,
    provider: ProviderContext,
  ): Promise<SignInResult> {
    const sys = this.database.system;

    const bound = await sys.identity.findUnique({
      where: { oidcIssuer_oidcSubject: { oidcIssuer: claims.issuer, oidcSubject: claims.subject } },
      include: { tenant: true },
    });
    if (bound) {
      const refused = await this.refusedByPolicy(bound.tenantId, provider);
      if (refused) return { ok: false, reason: refused, tenantId: bound.tenantId };
      return this.finish(bound.tenantId, bound.id, bound.status, bound.tenant.status, claims, meta);
    }

    if (!claims.email) return { ok: false, reason: "email_missing", tenantId: provider.tenantId };
    if (provider.requireEmailVerified && !claims.emailVerified)
      return { ok: false, reason: "email_unverified", tenantId: provider.tenantId };

    const domain = claims.email.split("@")[1] ?? "";
    // Cross-tenant by definition: the domain is what selects the tenant.
    const tenantDomain = await sys.tenantDomain.findUnique({
      where: { domain },
      include: { tenant: true },
    });
    if (!tenantDomain?.verifiedAt) {
      return {
        ok: false,
        reason: provider.tenantId ? "idp_tenant_mismatch" : "unknown_domain",
        tenantId: provider.tenantId,
      };
    }
    const tenantId = tenantDomain.tenantId;
    const refused = await this.refusedByPolicy(tenantId, provider);
    if (refused) return { ok: false, reason: refused, tenantId: provider.tenantId ?? tenantId };
    if (tenantDomain.tenant.status !== "active")
      return { ok: false, reason: "tenant_suspended", tenantId };

    const db = this.database.db;
    const existing = await db.identity.findUnique({
      where: { tenantId_email: { tenantId, email: claims.email }, tenantId },
    });
    if (existing) {
      let relinkedFrom: string | null = null;
      if (existing.oidcSubject) {
        // Same email, already linked: only a move to the tenant's own (different) provider may re-link.
        const movingToTenantIdp =
          provider.tenantId === tenantId && existing.oidcIssuer !== claims.issuer;
        if (!movingToTenantIdp) return { ok: false, reason: "subject_mismatch", tenantId };
        relinkedFrom = existing.oidcIssuer;
      }
      await db.identity.update({
        where: { id: existing.id, tenantId },
        data: { oidcIssuer: claims.issuer, oidcSubject: claims.subject, version: { increment: 1 } },
      });
      return this.finish(
        tenantId,
        existing.id,
        existing.status,
        "active",
        claims,
        meta,
        relinkedFrom,
      );
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
          metadata: { via: "oidc", role: "member", provider: provider.key },
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
    relinkedFrom: string | null = null,
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
      metadata: { issuer: claims.issuer, ...(relinkedFrom ? { relinkedFrom } : {}) },
    });
    return { ok: true, tenantId, identityId };
  }
}
