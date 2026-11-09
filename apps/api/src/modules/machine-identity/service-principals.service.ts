import { Inject, Injectable } from "@nestjs/common";
import {
  type CreateServicePrincipal,
  type IssuedSecret,
  isMachinePermission,
  type MachinePermission,
  type Permission,
  type ServicePrincipal,
  type TokenResponse,
  type UpdateServicePrincipal,
} from "@nf/contracts";
import { Prisma } from "@nf/db";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashSecret,
  issueAccessToken,
  newClientId,
  newClientSecret,
  sameHash,
  verifyAccessToken,
} from "./machine-token.js";

const DAY_MS = 86_400_000;
/** Bound the number of live secrets per principal (rotation needs two; leave headroom). */
const MAX_ACTIVE_SECRETS = 5;

const include = {
  secrets: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.ServicePrincipalInclude;
type Row = Prisma.ServicePrincipalGetPayload<{ include: typeof include }>;

function machinePermissions(value: unknown): MachinePermission[] {
  return (Array.isArray(value) ? value : []).filter(
    (p): p is MachinePermission => typeof p === "string" && isMachinePermission(p),
  );
}

function toDto(r: Row): ServicePrincipal {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    clientId: r.clientId,
    permissions: machinePermissions(r.permissions),
    status: r.status,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    secrets: r.secrets.map((s) => ({
      id: s.id,
      hint: s.hint,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
      revokedAt: s.revokedAt?.toISOString() ?? null,
    })),
    version: r.version,
  };
}

export class InvalidClientError extends Error {
  constructor() {
    super("invalid_client");
  }
}
export class InvalidScopeError extends Error {
  constructor() {
    super("invalid_scope");
  }
}

@Injectable()
export class ServicePrincipalsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private get issuer() {
    return this.config.publicUrl.origin;
  }

  async list(tenantId: string): Promise<ServicePrincipal[]> {
    const rows = await this.database.db.servicePrincipal.findMany({
      where: { tenantId },
      include,
      orderBy: { name: "asc" },
    });
    return rows.map(toDto);
  }

  async get(tenantId: string, id: string): Promise<ServicePrincipal> {
    const row = await this.database.db.servicePrincipal.findUnique({
      where: { id, tenantId },
      include,
    });
    if (!row) throw Errors.notFound("Service principal");
    return toDto(row);
  }

  async create(
    actor: Principal,
    input: CreateServicePrincipal,
    meta: RequestMeta,
  ): Promise<IssuedSecret> {
    const tenantId = actor.tenantId;
    const secret = newClientSecret();
    const expiresAt = new Date(Date.now() + input.secretLifetimeDays * DAY_MS);
    const permissions = [...new Set(input.permissions)];
    let created;
    try {
      created = await this.database.db.$transaction(async (tx) => {
        const sp = await tx.servicePrincipal.create({
          data: {
            tenantId,
            name: input.name,
            description: input.description,
            clientId: newClientId(),
            permissions,
            createdById: actor.identityId,
          },
        });
        const s = await tx.servicePrincipalSecret.create({
          data: {
            tenantId,
            servicePrincipalId: sp.id,
            secretHash: hashSecret(secret),
            hint: secret.slice(-4),
            expiresAt,
          },
        });
        await this.audit.record(
          {
            tenantId,
            action: "service_principal.created",
            outcome: "success",
            actor: { id: actor.identityId, label: actor.email },
            target: { type: "service_principal", id: sp.id, label: sp.name },
            meta,
            metadata: {
              permissions,
              clientId: sp.clientId,
              secretExpiresAt: expiresAt.toISOString(),
            },
          },
          tx,
        );
        return { sp, secretId: s.id };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw Errors.conflict(`A service principal named "${input.name}" already exists`);
      }
      throw err;
    }
    const sp = await this.get(tenantId, created.sp.id);
    return {
      servicePrincipal: sp,
      clientId: sp.clientId,
      clientSecret: secret,
      secretId: created.secretId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async update(
    actor: Principal,
    id: string,
    input: UpdateServicePrincipal,
    meta: RequestMeta,
  ): Promise<ServicePrincipal> {
    const tenantId = actor.tenantId;
    await this.database.db.$transaction(async (tx) => {
      const current = await tx.servicePrincipal.findUnique({ where: { id, tenantId } });
      if (!current) throw Errors.notFound("Service principal");
      const permissions = input.permissions ? [...new Set(input.permissions)] : undefined;
      const updated = await tx.servicePrincipal.updateMany({
        where: { id, tenantId, version: input.version },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(permissions ? { permissions } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw Errors.conflict(
          "This service principal was changed by someone else. Reload and try again.",
        );
      }
      await this.audit.record(
        {
          tenantId,
          action: "service_principal.updated",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "service_principal", id, label: current.name },
          meta,
          metadata: {
            reason: input.reason,
            ...(input.status ? { status: { from: current.status, to: input.status } } : {}),
            ...(permissions
              ? { permissions: { from: machinePermissions(current.permissions), to: permissions } }
              : {}),
          },
        },
        tx,
      );
    });
    return this.get(tenantId, id);
  }

  /** Rotation step 1: add a new secret while the old one keeps working. */
  async createSecret(
    actor: Principal,
    id: string,
    lifetimeDays: number,
    meta: RequestMeta,
  ): Promise<IssuedSecret> {
    const tenantId = actor.tenantId;
    const secret = newClientSecret();
    const expiresAt = new Date(Date.now() + lifetimeDays * DAY_MS);
    const secretId = await this.database.db.$transaction(async (tx) => {
      const sp = await tx.servicePrincipal.findUnique({ where: { id, tenantId } });
      if (!sp) throw Errors.notFound("Service principal");
      const live = await tx.servicePrincipalSecret.count({
        where: { tenantId, servicePrincipalId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (live >= MAX_ACTIVE_SECRETS) {
        throw Errors.conflict(
          `Revoke an old secret first (at most ${MAX_ACTIVE_SECRETS} can be active)`,
        );
      }
      const s = await tx.servicePrincipalSecret.create({
        data: {
          tenantId,
          servicePrincipalId: id,
          secretHash: hashSecret(secret),
          hint: secret.slice(-4),
          expiresAt,
        },
      });
      await this.audit.record(
        {
          tenantId,
          action: "service_principal.secret_created",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "service_principal", id, label: sp.name },
          meta,
          metadata: { secretId: s.id, hint: s.hint, expiresAt: expiresAt.toISOString() },
        },
        tx,
      );
      return s.id;
    });
    const sp = await this.get(tenantId, id);
    return {
      servicePrincipal: sp,
      clientId: sp.clientId,
      clientSecret: secret,
      secretId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Rotation step 2 (or incident response): tokens obtained with this secret stop working at once. */
  async revokeSecret(
    actor: Principal,
    id: string,
    secretId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<ServicePrincipal> {
    const tenantId = actor.tenantId;
    await this.database.db.$transaction(async (tx) => {
      const s = await tx.servicePrincipalSecret.findUnique({
        where: { id: secretId, tenantId },
        include: { servicePrincipal: true },
      });
      if (!s || s.servicePrincipalId !== id) throw Errors.notFound("Secret");
      if (s.revokedAt) return;
      await tx.servicePrincipalSecret.update({
        where: { id: secretId, tenantId },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          tenantId,
          action: "service_principal.secret_revoked",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "service_principal", id, label: s.servicePrincipal.name },
          meta,
          metadata: { secretId, hint: s.hint, reason },
        },
        tx,
      );
    });
    return this.get(tenantId, id);
  }

  /**
   * OAuth 2.0 client credentials grant. Throws InvalidClientError for any authentication
   * failure (unknown client, wrong/expired/revoked secret, disabled principal or tenant), so
   * responses never reveal which part was wrong.
   */
  async issueToken(
    clientId: string,
    clientSecret: string,
    scope: string | undefined,
    meta: RequestMeta,
  ): Promise<TokenResponse> {
    // Cross-tenant by definition: the client id identifies the tenant.
    const sp = await this.database.system.servicePrincipal.findUnique({
      where: { clientId },
      include: { secrets: true, tenant: true },
    });
    const now = new Date();
    const presented = hashSecret(clientSecret);
    const secret = sp?.secrets.find(
      (s) => !s.revokedAt && s.expiresAt > now && sameHash(new Uint8Array(s.secretHash), presented),
    );
    if (!sp || !secret || sp.status !== "active" || sp.tenant.status !== "active") {
      await this.audit.record({
        tenantId: sp?.tenantId ?? null,
        action: "service_principal.auth_failed",
        outcome: "failure",
        actor: { id: sp?.id ?? null, label: `service:${sp?.name ?? clientId.slice(0, 64)}` },
        meta,
        metadata: {
          clientId: clientId.slice(0, 64),
          reason: !sp
            ? "unknown_client"
            : !secret
              ? "bad_secret"
              : sp.status !== "active"
                ? "principal_disabled"
                : "tenant_suspended",
        },
      });
      throw new InvalidClientError();
    }

    const held = machinePermissions(sp.permissions);
    let granted: MachinePermission[] = held;
    if (scope !== undefined && scope.trim() !== "") {
      const requested = [...new Set(scope.trim().split(/\s+/))];
      if (!requested.every((p): p is MachinePermission => (held as string[]).includes(p))) {
        throw new InvalidScopeError();
      }
      granted = requested;
    }

    const { token, jti } = await issueAccessToken(this.config.sessionSecret, this.issuer, {
      sub: sp.id,
      tid: sp.tenantId,
      sid: secret.id,
      scp: granted,
    });
    await this.database.db.$transaction(async (tx) => {
      await tx.servicePrincipal.update({
        where: { id: sp.id, tenantId: sp.tenantId },
        data: { lastUsedAt: now },
      });
      await tx.servicePrincipalSecret.update({
        where: { id: secret.id, tenantId: sp.tenantId },
        data: { lastUsedAt: now },
      });
      await this.audit.record(
        {
          tenantId: sp.tenantId,
          action: "service_principal.token_issued",
          outcome: "success",
          actor: { id: sp.id, label: `service:${sp.name}` },
          target: { type: "service_principal", id: sp.id, label: sp.name },
          meta,
          metadata: { scope: granted, tokenId: jti, secretHint: secret.hint },
        },
        tx,
      );
    });
    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: granted.join(" "),
    };
  }

  /**
   * Resolves a bearer token to a principal, re-checking on every request that the principal,
   * the secret it was issued with and the tenant are still active. Effective permissions are
   * the token's scope ∩ the principal's current permissions, so a downgrade applies at once.
   */
  async resolveBearer(token: string): Promise<Principal | null> {
    const claims = await verifyAccessToken(this.config.sessionSecret, this.issuer, token);
    if (!claims) return null;
    const sp = await this.database.db.servicePrincipal.findUnique({
      where: { id: claims.sub, tenantId: claims.tid },
      include: { tenant: true, secrets: { where: { id: claims.sid } } },
    });
    const secret = sp?.secrets[0];
    const now = new Date();
    if (
      !sp ||
      sp.status !== "active" ||
      sp.tenant.status !== "active" ||
      !secret ||
      secret.revokedAt ||
      secret.expiresAt <= now
    ) {
      return null;
    }
    const current = new Set<string>(machinePermissions(sp.permissions));
    const permissions = new Set<Permission>(
      claims.scp.filter((p): p is MachinePermission => isMachinePermission(p) && current.has(p)),
    );
    return {
      kind: "service",
      sessionId: claims.jti,
      identityId: sp.id,
      tenantId: sp.tenantId,
      email: `service:${sp.name}`,
      displayName: sp.name,
      permissions,
      sessionExpiresAt: new Date(claims.exp * 1000),
    };
  }
}
