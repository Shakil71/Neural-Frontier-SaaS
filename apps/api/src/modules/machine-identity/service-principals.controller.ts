import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  CreateSecretSchema,
  CreateServicePrincipalSchema,
  TokenRequestSchema,
  UpdateServicePrincipalSchema,
} from "@nf/contracts";
import type { Request, Response } from "express";
import { z } from "zod";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta, requestMeta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { Public, RequirePermission } from "../authz/decorators.js";
import {
  InvalidClientError,
  InvalidScopeError,
  ServicePrincipalsService,
} from "./service-principals.service.js";

const RevokeSchema = z.object({ reason: z.string().trim().min(3).max(500) });

@ApiTags("service-principals")
@Controller("v1/service-principals")
export class ServicePrincipalsController {
  constructor(private readonly principals: ServicePrincipalsService) {}

  @Get()
  @RequirePermission("service_principals.read")
  list(@CurrentPrincipal() p: Principal) {
    return this.principals.list(p.tenantId);
  }

  @Get(":id")
  @RequirePermission("service_principals.read")
  get(@CurrentPrincipal() p: Principal, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.principals.get(p.tenantId, id);
  }

  /** Returns the client secret once. It is not stored and cannot be shown again. */
  @Post()
  @RequirePermission("service_principals.manage")
  create(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.principals.create(p, parse(CreateServicePrincipalSchema, body), meta);
  }

  @Patch(":id")
  @RequirePermission("service_principals.manage")
  update(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.principals.update(p, id, parse(UpdateServicePrincipalSchema, body), meta);
  }

  @Post(":id/secrets")
  @RequirePermission("service_principals.manage")
  createSecret(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    const input = parse(CreateSecretSchema, body ?? {});
    return this.principals.createSecret(p, id, input.secretLifetimeDays, meta);
  }

  @Delete(":id/secrets/:secretId")
  @RequirePermission("service_principals.manage")
  revokeSecret(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("secretId", new ParseUUIDPipe()) secretId: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.principals.revokeSecret(p, id, secretId, parse(RevokeSchema, body).reason, meta);
  }
}

/** Reads client_secret_basic credentials (RFC 6749 §2.3.1). */
function basicCredentials(header: string | undefined): { id: string; secret: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const i = decoded.indexOf(":");
  if (i < 1) return null;
  return {
    id: decodeURIComponent(decoded.slice(0, i)),
    secret: decodeURIComponent(decoded.slice(i + 1)),
  };
}

/**
 * OAuth 2.0 token endpoint (client credentials only). Errors use the RFC 6749 §5.2 shape
 * so standard OAuth client libraries understand them.
 */
@ApiTags("service-principals")
@Controller("v1/oauth")
export class OAuthController {
  constructor(private readonly principals: ServicePrincipalsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("token")
  @HttpCode(200)
  async token(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<
      string,
      unknown
    >;
    let basic: { id: string; secret: string } | null = null;
    try {
      basic = basicCredentials(req.get("authorization"));
    } catch {
      basic = null;
    }
    const parsed = TokenRequestSchema.safeParse({
      ...body,
      ...(basic ? { client_id: basic.id, client_secret: basic.secret } : {}),
    });
    if (!parsed.success) {
      const unsupported =
        typeof body.grant_type === "string" && body.grant_type !== "client_credentials";
      res.status(400);
      return {
        error: unsupported ? "unsupported_grant_type" : "invalid_request",
        error_description: unsupported
          ? "Only the client_credentials grant is supported"
          : "grant_type, client_id and client_secret are required",
      };
    }
    try {
      return await this.principals.issueToken(
        parsed.data.client_id,
        parsed.data.client_secret,
        parsed.data.scope,
        requestMeta(req),
      );
    } catch (err) {
      if (err instanceof InvalidClientError) {
        res.status(401);
        if (basic) res.setHeader("WWW-Authenticate", 'Basic realm="neural-frontier"');
        return { error: "invalid_client", error_description: "Client authentication failed" };
      }
      if (err instanceof InvalidScopeError) {
        res.status(400);
        return {
          error: "invalid_scope",
          error_description: "The requested scope exceeds the client's permissions",
        };
      }
      throw err;
    }
  }
}
