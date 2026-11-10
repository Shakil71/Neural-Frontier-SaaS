import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  Application,
  ApplicationType,
  CreateApplication,
  IssuedApplication,
  UpdateApplication,
} from "@nf/contracts";
import { type OAuthApplication, Prisma } from "@nf/db";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { hintOf } from "../../common/sealed.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";

const MAX_APPS = 100;

function sha256(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update(value, "utf8").digest());
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function toApplication(row: OAuthApplication): Application {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as ApplicationType,
    clientId: row.clientId,
    secretHint: row.secretHash ? row.secretHint : null,
    redirectUris: strings(row.redirectUris),
    postLogoutRedirectUris: strings(row.postLogoutRedirectUris),
    allowedRoleIds: row.allowedRoleIds === null ? null : strings(row.allowedRoleIds),
    enabled: row.enabled,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/** Applications that sign people in with Neural Frontier (OIDC clients). */
@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  get issuer(): string {
    return new URL("/api/oidc", this.config.publicUrl).toString();
  }

  async list(tenantId: string) {
    const rows = await this.database.db.oAuthApplication.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return {
      applications: rows.map(toApplication),
      issuer: this.issuer,
      discoveryUrl: `${this.issuer}/.well-known/openid-configuration`,
    };
  }

  private async assertRoles(tenantId: string, roleIds: string[] | null) {
    if (!roleIds?.length) return;
    const found = await this.database.db.role.count({ where: { tenantId, id: { in: roleIds } } });
    if (found !== new Set(roleIds).size)
      throw Errors.badRequest("One of the chosen roles doesn't exist.");
  }

  private newSecret() {
    const secret = `nfcs_${randomBytes(32).toString("base64url")}`;
    return { secret, secretHash: sha256(secret), secretHint: hintOf(secret) };
  }

  async create(
    actor: Principal,
    input: CreateApplication,
    meta: RequestMeta,
  ): Promise<IssuedApplication> {
    const tenantId = actor.tenantId;
    if ((await this.database.db.oAuthApplication.count({ where: { tenantId } })) >= MAX_APPS) {
      throw Errors.conflict(`An organisation can register at most ${MAX_APPS} applications.`);
    }
    await this.assertRoles(tenantId, input.allowedRoleIds);
    const confidential = input.type === "web";
    const secret = confidential ? this.newSecret() : null;
    const row = await this.database.db.$transaction(async (tx) => {
      const created = await tx.oAuthApplication.create({
        data: {
          tenantId,
          name: input.name,
          description: input.description,
          type: input.type,
          clientId: `nfapp_${randomBytes(16).toString("base64url")}`,
          secretHash: secret?.secretHash ?? null,
          secretHint: secret?.secretHint ?? null,
          redirectUris: input.redirectUris,
          postLogoutRedirectUris: input.postLogoutRedirectUris,
          allowedRoleIds: input.allowedRoleIds ?? undefined,
          enabled: input.enabled,
          createdById: actor.identityId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          action: "application.created",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "application", id: created.id, label: created.name },
          meta,
          metadata: {
            type: input.type,
            redirectUris: input.redirectUris,
            restricted: !!input.allowedRoleIds,
          },
        },
        tx,
      );
      return created;
    });
    return { application: toApplication(row), clientSecret: secret?.secret ?? null };
  }

  private async find(tenantId: string, id: string) {
    const row = await this.database.db.oAuthApplication.findUnique({ where: { id, tenantId } });
    if (!row) throw Errors.notFound("Application");
    return row;
  }

  async update(actor: Principal, id: string, input: UpdateApplication, meta: RequestMeta) {
    const tenantId = actor.tenantId;
    const before = await this.find(tenantId, id);
    await this.assertRoles(tenantId, input.allowedRoleIds);
    const row = await this.database.db.$transaction(async (tx) => {
      const res = await tx.oAuthApplication.updateMany({
        where: { id, tenantId, version: input.version },
        data: {
          name: input.name,
          description: input.description,
          redirectUris: input.redirectUris,
          postLogoutRedirectUris: input.postLogoutRedirectUris,
          // Prisma needs DbNull to store SQL NULL in a JSON column.
          allowedRoleIds: input.allowedRoleIds ?? Prisma.DbNull,
          enabled: input.enabled,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1)
        throw Errors.conflict("The application was changed by someone else. Reload and retry.");
      await this.audit.record(
        {
          tenantId,
          action: "application.updated",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "application", id, label: input.name },
          meta,
          metadata: {
            enabled: input.enabled,
            wasEnabled: before.enabled,
            redirectUris: input.redirectUris,
            restricted: !!input.allowedRoleIds,
          },
        },
        tx,
      );
      return tx.oAuthApplication.findUniqueOrThrow({ where: { id, tenantId } });
    });
    return toApplication(row);
  }

  async rotateSecret(actor: Principal, id: string, meta: RequestMeta): Promise<IssuedApplication> {
    const tenantId = actor.tenantId;
    const app = await this.find(tenantId, id);
    if (app.type !== "web") throw Errors.conflict("Only web applications have a client secret.");
    const secret = this.newSecret();
    const row = await this.database.db.$transaction(async (tx) => {
      await tx.oAuthApplication.updateMany({
        where: { id, tenantId },
        data: {
          secretHash: secret.secretHash,
          secretHint: secret.secretHint,
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          tenantId,
          action: "application.secret_rotated",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "application", id, label: app.name },
          meta,
        },
        tx,
      );
      return tx.oAuthApplication.findUniqueOrThrow({ where: { id, tenantId } });
    });
    return { application: toApplication(row), clientSecret: secret.secret };
  }

  async remove(actor: Principal, id: string, meta: RequestMeta) {
    const tenantId = actor.tenantId;
    const app = await this.find(tenantId, id);
    await this.database.db.$transaction(async (tx) => {
      await tx.oAuthAuthorizationCode.deleteMany({ where: { tenantId, applicationId: id } });
      await tx.oAuthApplication.deleteMany({ where: { id, tenantId } });
      await this.audit.record(
        {
          tenantId,
          action: "application.deleted",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "application", id, label: app.name },
          meta,
        },
        tx,
      );
    });
  }

  /** Cross-tenant by definition: the client id identifies the tenant. */
  async byClientId(clientId: string): Promise<OAuthApplication | null> {
    if (!/^nfapp_[A-Za-z0-9_-]{22}$/.test(clientId)) return null;
    return this.database.system.oAuthApplication.findUnique({ where: { clientId } });
  }

  secretMatches(app: OAuthApplication, secret: string): boolean {
    if (!app.secretHash) return false;
    return timingSafeEqual(Buffer.from(app.secretHash), Buffer.from(sha256(secret)));
  }
}
