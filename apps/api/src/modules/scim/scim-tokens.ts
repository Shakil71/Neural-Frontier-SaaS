import { createHash, randomBytes } from "node:crypto";
import {
  type CanActivate,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CreateScimTokenSchema, type IssuedScimToken, type ScimToken } from "@nf/contracts";
import type { Prisma } from "@nf/db";
import type { Request } from "express";
import { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { RequirePermission } from "../authz/decorators.js";

const MAX_ACTIVE_TOKENS = 5;
const DAY_MS = 86_400_000;
const TOUCH_INTERVAL_MS = 60_000;

export const scimHash = (token: string) =>
  new Uint8Array(createHash("sha256").update(token, "utf8").digest());

/** The SCIM client a request was authenticated as. */
export interface ScimCaller {
  tenantId: string;
  tokenId: string;
  label: string;
}

declare module "express-serve-static-core" {
  interface Request {
    scim?: ScimCaller;
  }
}

export class ScimAuthError extends Error {}

function toDto(r: Prisma.ScimTokenGetPayload<object>): ScimToken {
  return {
    id: r.id,
    name: r.name,
    hint: r.hint,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ScimTokensService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  get baseUrl() {
    return new URL("/api/scim/v2", this.config.publicUrl).toString();
  }

  async list(tenantId: string): Promise<ScimToken[]> {
    const rows = await this.database.db.scimToken.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDto);
  }

  async create(
    actor: Principal,
    input: z.infer<typeof CreateScimTokenSchema>,
    meta: RequestMeta,
  ): Promise<IssuedScimToken> {
    const tenantId = actor.tenantId;
    const token = `nfscim_${randomBytes(32).toString("base64url")}`;
    const row = await this.database.db.$transaction(async (tx) => {
      const live = await tx.scimToken.count({
        where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (live >= MAX_ACTIVE_TOKENS) {
        throw Errors.conflict(
          `Revoke an old token first (at most ${MAX_ACTIVE_TOKENS} can be active)`,
        );
      }
      const created = await tx.scimToken.create({
        data: {
          tenantId,
          name: input.name,
          tokenHash: scimHash(token),
          hint: token.slice(-4),
          expiresAt: new Date(Date.now() + input.lifetimeDays * DAY_MS),
          createdById: actor.identityId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          action: "scim.token_created",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "scim_token", id: created.id, label: created.name },
          meta,
          metadata: { hint: created.hint, expiresAt: created.expiresAt.toISOString() },
        },
        tx,
      );
      return created;
    });
    return { token, scimToken: toDto(row), baseUrl: this.baseUrl };
  }

  async revoke(
    actor: Principal,
    id: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<ScimToken> {
    const tenantId = actor.tenantId;
    return this.database.db.$transaction(async (tx) => {
      const row = await tx.scimToken.findUnique({ where: { id, tenantId } });
      if (!row) throw Errors.notFound("SCIM token");
      if (row.revokedAt) return toDto(row);
      const updated = await tx.scimToken.update({
        where: { id, tenantId },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          tenantId,
          action: "scim.token_revoked",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "scim_token", id, label: row.name },
          meta,
          metadata: { hint: row.hint, reason },
        },
        tx,
      );
      return toDto(updated);
    });
  }

  /** Resolves a SCIM bearer token, or throws ScimAuthError. Revocation takes effect at once. */
  async authenticate(header: string | undefined): Promise<ScimCaller> {
    const match = /^Bearer (nfscim_[A-Za-z0-9_-]{43})$/.exec(header ?? "");
    if (!match) throw new ScimAuthError("Bearer token required");
    // Cross-tenant by definition: the token identifies the tenant.
    const row = await this.database.system.scimToken.findUnique({
      where: { tokenHash: scimHash(match[1]!) },
      include: { tenant: true },
    });
    const now = new Date();
    if (!row || row.revokedAt || row.expiresAt <= now || row.tenant.status !== "active") {
      throw new ScimAuthError("Invalid, expired or revoked token");
    }
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.database.db.scimToken.update({
        where: { id: row.id, tenantId: row.tenantId },
        data: { lastUsedAt: now },
      });
    }
    return { tenantId: row.tenantId, tokenId: row.id, label: `scim:${row.name}` };
  }
}

/** Authenticates SCIM requests (the routes are @Public to the session/bearer guard). */
@Injectable()
export class ScimAuthGuard implements CanActivate {
  private readonly logger = new Logger(ScimAuthGuard.name);

  constructor(private readonly tokens: ScimTokensService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    try {
      req.scim = await this.tokens.authenticate(req.get("authorization"));
      return true;
    } catch (err) {
      if (err instanceof ScimAuthError) {
        this.logger.warn({ ip: req.ip, reason: err.message }, "SCIM authentication failed");
        throw Errors.unauthenticated(err.message);
      }
      throw err;
    }
  }
}

const RevokeSchema = z.object({ reason: z.string().trim().min(3).max(500) });

/** Owner-only management of SCIM tokens (Organisation → Provisioning). */
@ApiTags("scim")
@Controller("v1/tenant/scim-tokens")
export class ScimTokensController {
  constructor(private readonly tokens: ScimTokensService) {}

  @Get()
  @RequirePermission("tenant.read")
  async list(@CurrentPrincipal() p: Principal) {
    return { baseUrl: this.tokens.baseUrl, tokens: await this.tokens.list(p.tenantId) };
  }

  /** Returns the token once. */
  @Post()
  @RequirePermission("tenant.sso.manage")
  create(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.tokens.create(p, parse(CreateScimTokenSchema, body ?? {}), meta);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("tenant.sso.manage")
  revoke(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.tokens.revoke(p, id, parse(RevokeSchema, body).reason, meta);
  }
}
