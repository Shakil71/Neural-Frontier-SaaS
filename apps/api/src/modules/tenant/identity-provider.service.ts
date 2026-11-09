import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  SetIdpEnforcement,
  TenantIdentityProvider,
  UpsertIdentityProvider,
} from "@nf/contracts";
import type { Prisma } from "@nf/db";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { AppError, Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { hintOf, seal } from "../../common/sealed.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { OidcService, tenantIdpSecretContext } from "../auth/oidc.service.js";

type Row = Prisma.TenantIdentityProviderGetPayload<object>;

/** Issuers are compared loosely only to detect "same provider"; they are stored exactly as stated. */
const norm = (s: string) => s.replace(/\/+$/, "");

/** A tenant's own OIDC provider: configure, require, remove. Owner-only (`tenant.sso.manage`). */
@Injectable()
export class IdentityProviderService {
  private readonly logger = new Logger(IdentityProviderService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly oidc: OidcService,
  ) {}

  private toDto(r: Row): TenantIdentityProvider {
    return {
      id: r.id,
      issuer: r.issuer,
      clientId: r.clientId,
      secretHint: r.secretHint,
      requireEmailVerified: r.requireEmailVerified,
      enforcement: r.enforcement,
      redirectUri: this.oidc.redirectUri,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      version: r.version,
    };
  }

  async get(tenantId: string): Promise<TenantIdentityProvider | null> {
    const row = await this.database.db.tenantIdentityProvider.findUnique({ where: { tenantId } });
    return row ? this.toDto(row) : null;
  }

  private async load(tenantId: string): Promise<Row> {
    const row = await this.database.db.tenantIdentityProvider.findUnique({ where: { tenantId } });
    if (!row) throw Errors.notFound("Identity provider");
    return row;
  }

  /**
   * Creates or replaces the configuration. The provider's discovery document must load with
   * these settings before anything is saved, so a typo can't break sign-in.
   */
  async upsert(
    actor: Principal,
    input: UpsertIdentityProvider,
    meta: RequestMeta,
  ): Promise<TenantIdentityProvider> {
    const key = this.config.dataKey;
    if (!key) throw Errors.unavailable("NF_DATA_KEY is not configured on this deployment");
    const tenantId = actor.tenantId;
    const issuer = new URL(input.issuer);
    if (issuer.protocol !== "https:" && !this.config.oidcAllowInsecureHttp) {
      throw Errors.badRequest("The issuer must use https://");
    }
    if (this.config.oidc && norm(issuer.href) === norm(this.config.oidc.issuer.href)) {
      throw Errors.badRequest(
        "That is this deployment's shared identity provider. Use a provider your organisation controls.",
      );
    }

    const current = await this.database.db.tenantIdentityProvider.findUnique({
      where: { tenantId },
    });
    if (current && input.version === undefined) {
      throw Errors.conflict("An identity provider is already configured. Reload and edit it.");
    }
    if (!current && !input.clientSecret) throw Errors.badRequest("A client secret is required");

    const secret = input.clientSecret;
    if (current && norm(current.issuer) !== norm(issuer.href) && !secret) {
      throw Errors.badRequest("Enter the client secret for the new provider");
    }
    // Validate against the provider itself before saving (discovery needs no secret), and keep
    // the issuer exactly as the provider states it: ID tokens must match it byte for byte.
    let stated: string;
    try {
      stated = await this.oidc.probe(issuer, input.clientId, secret ?? "not-needed-for-discovery");
    } catch (err) {
      this.logger.warn({ err: String(err), issuer: issuer.href }, "IdP discovery failed");
      throw new AppError(
        "bad_request",
        400,
        `Couldn't load ${new URL(".well-known/openid-configuration", issuer.href.endsWith("/") ? issuer : `${issuer.href}/`).href}. Check the issuer URL.`,
      );
    }

    // If the issuer changes, "required" falls back to "optional": the owner must prove the new
    // provider works (by signing in with it) before requiring it again.
    const issuerChanged = current !== null && current.issuer !== stated;
    await this.database.db.$transaction(async (tx) => {
      if (current) {
        const res = await tx.tenantIdentityProvider.updateMany({
          where: { tenantId, version: input.version },
          data: {
            issuer: stated,
            clientId: input.clientId,
            requireEmailVerified: input.requireEmailVerified,
            ...(issuerChanged ? { enforcement: "optional" as const } : {}),
            ...(secret
              ? {
                  secretCiphertext: seal(key, secret, tenantIdpSecretContext(tenantId)),
                  secretHint: hintOf(secret),
                }
              : {}),
            version: { increment: 1 },
          },
        });
        if (res.count === 0) {
          throw Errors.conflict(
            "The configuration was changed by someone else. Reload and try again.",
          );
        }
      } else {
        await tx.tenantIdentityProvider.create({
          data: {
            tenantId,
            issuer: stated,
            clientId: input.clientId,
            requireEmailVerified: input.requireEmailVerified,
            secretCiphertext: seal(key, secret!, tenantIdpSecretContext(tenantId)),
            secretHint: hintOf(secret!),
            createdById: actor.identityId,
          },
        });
      }
      await this.audit.record(
        {
          tenantId,
          action: "tenant.idp_configured",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "identity_provider", id: tenantId, label: stated },
          meta,
          metadata: {
            issuer: stated,
            clientId: input.clientId,
            requireEmailVerified: input.requireEmailVerified,
            created: !current,
            secretChanged: Boolean(secret),
            ...(issuerChanged ? { previousIssuer: current.issuer, enforcementReset: true } : {}),
          },
        },
        tx,
      );
    });
    return (await this.get(tenantId))!;
  }

  /**
   * Requiring the tenant's provider is only allowed once the acting owner has signed in through
   * it: proof that it works, so nobody (including the owner) is locked out by a broken setup.
   */
  async setEnforcement(
    actor: Principal,
    input: SetIdpEnforcement,
    meta: RequestMeta,
  ): Promise<TenantIdentityProvider> {
    const tenantId = actor.tenantId;
    const row = await this.load(tenantId);
    if (input.enforcement === "required") {
      const me = await this.database.db.identity.findUnique({
        where: { id: actor.identityId, tenantId },
      });
      if (me?.oidcIssuer !== row.issuer) {
        throw Errors.conflict(
          "Sign out and sign in once through your organisation's provider before requiring it.",
        );
      }
    }
    await this.database.db.$transaction(async (tx) => {
      const res = await tx.tenantIdentityProvider.updateMany({
        where: { tenantId, version: input.version },
        data: { enforcement: input.enforcement, version: { increment: 1 } },
      });
      if (res.count === 0) {
        throw Errors.conflict(
          "The configuration was changed by someone else. Reload and try again.",
        );
      }
      await this.audit.record(
        {
          tenantId,
          action: "tenant.idp_enforcement_changed",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "identity_provider", id: tenantId, label: row.issuer },
          meta,
          metadata: { from: row.enforcement, to: input.enforcement, reason: input.reason },
        },
        tx,
      );
    });
    return (await this.get(tenantId))!;
  }

  /**
   * Removes the tenant's provider; sign-in falls back to the deployment-wide one. Refused when
   * there is no deployment-wide provider, since nobody could sign in afterwards.
   */
  async remove(actor: Principal, reason: string, meta: RequestMeta): Promise<void> {
    const tenantId = actor.tenantId;
    const row = await this.load(tenantId);
    if (!this.oidc.configured) {
      throw Errors.conflict(
        "This deployment has no shared identity provider, so removing yours would lock everyone out.",
      );
    }
    await this.database.db.$transaction(async (tx) => {
      await tx.tenantIdentityProvider.delete({ where: { tenantId } });
      // People who moved to this provider are unlinked, so their next sign-in through the shared
      // provider links them again by verified email instead of locking them out.
      const unlinked = await tx.identity.updateMany({
        where: { tenantId, oidcIssuer: row.issuer },
        data: { oidcIssuer: null, oidcSubject: null, version: { increment: 1 } },
      });
      await this.audit.record(
        {
          tenantId,
          action: "tenant.idp_removed",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "identity_provider", id: tenantId, label: row.issuer },
          meta,
          metadata: { issuer: row.issuer, reason, unlinkedIdentities: unlinked.count },
        },
        tx,
      );
    });
  }
}
