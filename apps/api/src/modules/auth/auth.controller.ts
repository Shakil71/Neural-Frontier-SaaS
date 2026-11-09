import { Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Session } from "@nf/contracts";
import type { CookieOptions, Request, Response } from "express";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { Principal } from "../../common/principal.js";
import { CurrentPrincipal, requestMeta } from "../../common/request.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { Public } from "../authz/decorators.js";
import { LOGIN_STATE_TTL_MS, openLoginState, sealLoginState } from "./login-state.js";
import { OidcService } from "./oidc.service.js";
import { ProvisioningService } from "./provisioning.service.js";
import { SessionService } from "./session.service.js";
import { csrfTokenFor, safeReturnTo } from "./tokens.js";

const AUTH_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@ApiTags("auth")
@Controller("v1/auth")
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly oidc: OidcService,
    private readonly provisioning: ProvisioningService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  private cookie(maxAge: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookie.secure,
      sameSite: "lax",
      path: "/",
      maxAge,
    };
  }

  private web(path: string): string {
    return new URL(path, this.config.publicUrl).toString();
  }

  /** Starts SSO: redirects the browser to the identity provider. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Get("login")
  async login(@Query("returnTo") returnTo: unknown, @Res() res: Response) {
    if (!this.oidc.configured)
      return res.redirect(303, this.web("/sign-in?error=sso_not_configured"));
    const { url, state } = await this.oidc.beginLogin(safeReturnTo(returnTo));
    res.cookie(
      this.config.cookie.loginStateName,
      await sealLoginState(this.config.sessionSecret, state),
      this.cookie(LOGIN_STATE_TTL_MS),
    );
    return res.redirect(303, url.toString());
  }

  /** IdP redirects here. Validates the response, provisions/links the identity, opens a session. */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Get("callback")
  async callback(@Req() req: Request, @Res() res: Response) {
    const meta = requestMeta(req);
    const state = await openLoginState(
      this.config.sessionSecret,
      req.cookies?.[this.config.cookie.loginStateName],
    );
    res.clearCookie(this.config.cookie.loginStateName, { path: "/" });
    if (!state) return res.redirect(303, this.web("/sign-in?error=login_expired"));

    const callbackUrl = new URL(req.originalUrl, this.oidc.redirectUri);
    let claims;
    try {
      claims = await this.oidc.completeLogin(callbackUrl, state);
    } catch (err) {
      req.log?.warn({ err }, "OIDC callback rejected");
      return res.redirect(303, this.web("/sign-in?error=sso_failed"));
    }

    const result = await this.provisioning.signIn(claims, meta);
    if (!result.ok) return res.redirect(303, this.web(`/sign-in?error=${result.reason}`));

    const { token } = await this.sessions.create(result.tenantId, result.identityId, meta);
    res.cookie(this.config.cookie.sessionName, token, this.cookie(this.config.session.absoluteMs));
    return res.redirect(303, this.web(state.returnTo));
  }

  /** Current session, permissions and the CSRF token the web app must echo back. */
  @Get("session")
  async session(@CurrentPrincipal() p: Principal): Promise<Session> {
    const tenant = await this.database.system.tenant.findUniqueOrThrow({
      where: { id: p.tenantId },
    });
    return {
      user: { id: p.identityId, email: p.email, displayName: p.displayName },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      permissions: [...p.permissions].sort(),
      csrfToken: csrfTokenFor(this.config.sessionSecret, p.sessionId),
      expiresAt: p.sessionExpiresAt.toISOString(),
    };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.revoke(p.tenantId, p.sessionId);
    await this.audit.record({
      tenantId: p.tenantId,
      action: "auth.sign_out",
      outcome: "success",
      actor: { id: p.identityId, label: p.email },
      meta: requestMeta(req),
    });
    res.clearCookie(this.config.cookie.sessionName, { path: "/" });
  }
}
