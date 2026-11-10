import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Options,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CreateApplicationSchema, UpdateApplicationSchema } from "@nf/contracts";
import type { Request, Response } from "express";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta, requestMeta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { SessionService } from "../auth/session.service.js";
import { Public, RequirePermission } from "../authz/decorators.js";
import { ApplicationsService } from "./applications.service.js";
import {
  type AuthorizeRequest,
  AuthorizePageError,
  OAuthError,
  OidcProviderService,
} from "./provider.service.js";

/** Endpoints applications call from browsers (SPAs): open CORS, no cookies involved. */
function cors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
}

function sendOAuthError(res: Response, err: unknown) {
  if (!(err instanceof OAuthError)) throw err;
  if (err.status === 401) {
    res.setHeader("WWW-Authenticate", `Bearer error="${err.error}"`);
  }
  res.status(err.status).json({ error: err.error, error_description: err.description });
}

/**
 * OpenID Connect provider endpoints (/api/oidc). Public to the session guard: the authorization
 * endpoint reads the session itself; the others authenticate clients or tokens.
 */
@ApiExcludeController()
@Public()
@Controller("oidc")
export class OidcProviderController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly provider: OidcProviderService,
    private readonly sessions: SessionService,
  ) {}

  private web(path: string) {
    return new URL(path, this.config.publicUrl).toString();
  }

  @Get(".well-known/openid-configuration")
  discovery(@Res({ passthrough: true }) res: Response) {
    cors(res);
    res.setHeader("Cache-Control", "public, max-age=300");
    return this.provider.discovery();
  }

  @Get("jwks")
  async jwks(@Res({ passthrough: true }) res: Response) {
    cors(res);
    res.setHeader("Cache-Control", "public, max-age=300");
    return this.provider.jwks();
  }

  @Get("authorize")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async authorize(@Req() req: Request, @Res() res: Response, @Query() query: AuthorizeRequest) {
    const token = req.cookies?.[this.config.cookie.sessionName];
    const principal = typeof token === "string" ? await this.sessions.resolve(token) : null;
    const rawQuery = req.originalUrl.split("?")[1] ?? "";
    try {
      const outcome = await this.provider.authorize(query, principal, rawQuery, requestMeta(req));
      if (outcome.kind === "redirect") return res.redirect(303, outcome.url);
      const params = new URLSearchParams({ returnTo: outcome.returnTo });
      if (outcome.loginHint) params.set("email", outcome.loginHint);
      return res.redirect(303, this.web(`/sign-in?${params}`));
    } catch (err) {
      if (err instanceof AuthorizePageError) {
        return res.redirect(303, this.web(`/sign-in/app-error?reason=${err.reason}`));
      }
      throw err;
    }
  }

  @Options(["token", "userinfo", "jwks", ".well-known/openid-configuration"])
  @HttpCode(204)
  preflight(@Res({ passthrough: true }) res: Response) {
    cors(res);
  }

  @Post("token")
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async token(@Req() req: Request, @Res() res: Response, @Body() body: unknown) {
    cors(res);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    try {
      const form = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
      res.json(await this.provider.token(req.get("authorization"), form));
    } catch (err) {
      sendOAuthError(res, err);
    }
  }

  @Get("userinfo")
  async userinfo(@Req() req: Request, @Res() res: Response) {
    cors(res);
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await this.provider.userinfo(req.get("authorization")));
    } catch (err) {
      sendOAuthError(res, err);
    }
  }

  @Post("userinfo")
  @HttpCode(200)
  userinfoPost(@Req() req: Request, @Res() res: Response) {
    return this.userinfo(req, res);
  }

  @Get("logout")
  async logout(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, unknown>) {
    const token = req.cookies?.[this.config.cookie.sessionName];
    const principal = typeof token === "string" ? await this.sessions.resolve(token) : null;
    const { redirect, endedSession } = await this.provider.endSession(
      query,
      principal,
      requestMeta(req),
    );
    if (endedSession) res.clearCookie(this.config.cookie.sessionName, { path: "/" });
    res.redirect(303, redirect);
  }
}

/** Admin Center → Applications. */
@ApiTags("applications")
@Controller("v1/applications")
export class ApplicationsController {
  constructor(private readonly apps: ApplicationsService) {}

  @Get()
  @RequirePermission("applications.read")
  list(@CurrentPrincipal() p: Principal) {
    return this.apps.list(p.tenantId);
  }

  @Post()
  @RequirePermission("applications.manage")
  create(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.apps.create(p, parse(CreateApplicationSchema, body), meta);
  }

  @Put(":id")
  @RequirePermission("applications.manage")
  update(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.apps.update(p, id, parse(UpdateApplicationSchema, body), meta);
  }

  @Post(":id/secret")
  @HttpCode(200)
  @RequirePermission("applications.manage")
  rotate(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.apps.rotateSecret(p, id, meta);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("applications.manage")
  async remove(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Meta() meta: RequestMeta,
  ) {
    await this.apps.remove(p, id, meta);
  }
}
