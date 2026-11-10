import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  AdminCredentialActionSchema,
  ChangePasswordSchema,
  CreateSignInLinkSchema,
  DiscoverSignInSchema,
  PasswordSignInSchema,
  RedeemSignInLinkSchema,
  RequestPasswordResetSchema,
  SecondFactorCodeSchema,
  SignInLinkTokenSchema,
  type SignInStep,
  UpdateSignInPolicySchema,
} from "@nf/contracts";
import type { CookieOptions, Request, Response } from "express";
import { z } from "zod";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { CurrentPrincipal, Meta, requestMeta } from "../../common/request.js";
import { parse } from "../../common/validation.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { Public, RequirePermission } from "../authz/decorators.js";
import { CHALLENGE_TTL_SECONDS, openChallenge, sealChallenge } from "./challenge.js";
import { LocalAuthService } from "./local-auth.service.js";

const SIGN_IN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Public routes skip the session CSRF check, so they defend themselves against login CSRF
 * (signing a victim in to the attacker's account): a cross-site Origin is refused, and only
 * JSON bodies are accepted, which cross-site HTML forms cannot send without a CORS preflight.
 */
function assertSameSiteJson(req: Request, config: AppConfig) {
  const origin = req.get("origin");
  if (origin && origin !== config.publicUrl.origin) {
    throw Errors.forbidden("Cross-origin request refused");
  }
  if (!req.is("application/json")) throw Errors.badRequest("Send JSON");
}

/** Built-in sign-in: email → password → (second factor) → session. */
@ApiTags("auth")
@Controller("v1/auth")
export class SignInController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly local: LocalAuthService,
  ) {}

  private cookie(maxAgeMs: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookie.secure,
      sameSite: "lax",
      path: "/",
      maxAge: maxAgeMs,
    };
  }

  private async signedIn(
    res: Response,
    tenantId: string,
    identityId: string,
    returnTo: string,
    meta: RequestMeta,
    twoFactor: boolean,
    recoveryCodes?: string[],
  ): Promise<SignInStep> {
    const token = await this.local.startSession(tenantId, identityId, meta, twoFactor);
    res.cookie(this.config.cookie.sessionName, token, this.cookie(this.config.session.absoluteMs));
    res.clearCookie(this.config.cookie.challengeName, { path: "/" });
    return {
      status: "signed_in",
      redirectTo: returnTo,
      ...(recoveryCodes ? { recoveryCodes } : {}),
    };
  }

  /** What the sign-in screen offers before an email is entered. */
  @Public()
  @Get("options")
  options() {
    return this.local.options();
  }

  /** Which ways of signing in to offer for an email (decided by its domain). */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("discover")
  @HttpCode(200)
  discover(@Req() req: Request, @Body() body: unknown) {
    assertSameSiteJson(req, this.config);
    return this.local.discover(parse(DiscoverSignInSchema, body).email);
  }

  @Public()
  @Throttle(SIGN_IN_THROTTLE)
  @Post("password")
  @HttpCode(200)
  async password(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ): Promise<SignInStep> {
    assertSameSiteJson(req, this.config);
    const meta = requestMeta(req);
    const outcome = await this.local.signInWithPassword(parse(PasswordSignInSchema, body), meta);
    if (outcome.kind === "session") {
      return this.signedIn(
        res,
        outcome.tenantId,
        outcome.identityId,
        outcome.returnTo,
        meta,
        false,
      );
    }
    res.cookie(
      this.config.cookie.challengeName,
      await sealChallenge(this.config.sessionSecret, outcome.challenge),
      { ...this.cookie(CHALLENGE_TTL_SECONDS * 1000), sameSite: "strict" },
    );
    return outcome.setup
      ? { status: "two_factor_setup_required", setup: outcome.setup }
      : { status: "two_factor_required" };
  }

  /** Second step: an authenticator code (or recovery code), or confirming a new authenticator. */
  @Public()
  @Throttle(SIGN_IN_THROTTLE)
  @Post("two-factor")
  @HttpCode(200)
  async twoFactor(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ): Promise<SignInStep> {
    assertSameSiteJson(req, this.config);
    const challenge = await openChallenge(
      this.config.sessionSecret,
      req.cookies?.[this.config.cookie.challengeName],
    );
    if (!challenge) throw Errors.unauthenticated("Your sign-in timed out. Start again.");
    const meta = requestMeta(req);
    const { recoveryCodes } = await this.local.completeSecondFactor(
      challenge,
      parse(SecondFactorCodeSchema, body).code,
      meta,
    );
    return this.signedIn(
      res,
      challenge.tenantId,
      challenge.identityId,
      challenge.returnTo,
      meta,
      true,
      recoveryCodes ?? undefined,
    );
  }

  /** What a setup/reset link is for. POST keeps the token out of URLs and access logs. */
  @Public()
  @Throttle(SIGN_IN_THROTTLE)
  @Post("sign-in-links/inspect")
  @HttpCode(200)
  inspectLink(@Req() req: Request, @Body() body: unknown) {
    assertSameSiteJson(req, this.config);
    const { token } = parse(z.object({ token: SignInLinkTokenSchema }), body);
    return this.local.linkInfo(token);
  }

  @Public()
  @Throttle(SIGN_IN_THROTTLE)
  @Post("sign-in-links/redeem")
  @HttpCode(200)
  redeemLink(@Req() req: Request, @Body() body: unknown) {
    assertSameSiteJson(req, this.config);
    const { token, password } = parse(RedeemSignInLinkSchema, body);
    return this.local.redeemLink(token, password, requestMeta(req));
  }

  /**
   * "Forgot password?". Always 202 with the same body, whether or not an account exists or an
   * email was sent, so it can't be used to find out who has an account.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("password-reset")
  @HttpCode(202)
  async passwordReset(@Req() req: Request, @Body() body: unknown) {
    assertSameSiteJson(req, this.config);
    await this.local.requestPasswordReset(
      parse(RequestPasswordResetSchema, body).email,
      requestMeta(req),
    );
    return { accepted: true };
  }
}

/** My account → Where you're signed in. */
@ApiTags("me")
@Controller("v1/me/sessions")
export class MySessionsController {
  constructor(private readonly local: LocalAuthService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.local.mySessions(p);
  }

  @Delete(":sessionId")
  @HttpCode(200)
  revoke(
    @CurrentPrincipal() p: Principal,
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Meta() meta: RequestMeta,
  ) {
    return this.local.revokeMySession(p, sessionId, meta);
  }

  @Post("revoke-others")
  @HttpCode(200)
  revokeOthers(@CurrentPrincipal() p: Principal, @Meta() meta: RequestMeta) {
    return this.local.revokeMyOtherSessions(p, meta);
  }
}

/** My account → Security. Any signed-in person, for themselves only. */
@ApiTags("me")
@Controller("v1/me/security")
export class MySecurityController {
  constructor(private readonly local: LocalAuthService) {}

  @Get()
  get(@CurrentPrincipal() p: Principal) {
    return this.local.mySecurity(p);
  }

  @Put("password")
  @Throttle(SIGN_IN_THROTTLE)
  changePassword(
    @CurrentPrincipal() p: Principal,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.local.changePassword(p, parse(ChangePasswordSchema, body), meta);
  }

  @Post("two-factor/setup")
  @HttpCode(200)
  setup(@CurrentPrincipal() p: Principal) {
    return this.local.beginTwoFactorSetup(p);
  }

  @Post("two-factor/enable")
  @HttpCode(200)
  @Throttle(SIGN_IN_THROTTLE)
  async enable(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const codes = await this.local.enableTwoFactor(
      p,
      parse(SecondFactorCodeSchema, body).code,
      meta,
    );
    return { recoveryCodes: codes };
  }

  @Post("two-factor/disable")
  @HttpCode(200)
  @Throttle(SIGN_IN_THROTTLE)
  disable(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.local.disableTwoFactor(p, parse(SecondFactorCodeSchema, body).code, meta);
  }

  @Post("recovery-codes")
  @HttpCode(200)
  @Throttle(SIGN_IN_THROTTLE)
  async recoveryCodes(
    @CurrentPrincipal() p: Principal,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    const codes = await this.local.regenerateRecoveryCodes(
      p,
      parse(SecondFactorCodeSchema, body).code,
      meta,
    );
    return { recoveryCodes: codes };
  }
}

/** Administrators: how a person signs in, and helping them back in. */
@ApiTags("identities")
@Controller("v1/identities/:id/sign-in")
export class IdentitySignInController {
  constructor(private readonly local: LocalAuthService) {}

  @Get()
  @RequirePermission("identities.read")
  get(@CurrentPrincipal() p: Principal, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.local.signInMethods(p, id);
  }

  /** A one-time link to set (or reset) the password. Returned once. */
  @Post("link")
  @HttpCode(200)
  @RequirePermission("identities.manage")
  link(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    const input = parse(CreateSignInLinkSchema, body);
    return this.local.createSignInLink(p, p.tenantId, id, input.reason, meta, {
      sendEmail: input.sendEmail,
      kind: "admin",
    });
  }

  /** Ends every session of this person (a lost laptop, a departure). */
  @Post("sessions/revoke")
  @HttpCode(200)
  @RequirePermission("identities.manage")
  signOutEverywhere(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.local.signOutEverywhere(
      p,
      id,
      parse(AdminCredentialActionSchema, body).reason,
      meta,
    );
  }

  @Post("reset-two-factor")
  @HttpCode(200)
  @RequirePermission("identities.manage")
  resetTwoFactor(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.local.resetTwoFactor(p, id, parse(AdminCredentialActionSchema, body).reason, meta);
  }

  @Post("unlock")
  @HttpCode(200)
  @RequirePermission("identities.manage")
  unlock(
    @CurrentPrincipal() p: Principal,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
  ) {
    return this.local.unlock(p, id, parse(AdminCredentialActionSchema, body).reason, meta);
  }
}

/** Tenant sign-in policy (owner-only to change: it decides how everyone gets in). */
@ApiTags("tenant")
@Controller("v1/tenant/sign-in-policy")
export class SignInPolicyController {
  constructor(private readonly local: LocalAuthService) {}

  @Get()
  @RequirePermission("tenant.read")
  get(@CurrentPrincipal() p: Principal) {
    return this.local.policy(p.tenantId);
  }

  /** Who can already sign in without the deployment-wide provider. */
  @Get("readiness")
  @RequirePermission("tenant.read")
  readiness(@CurrentPrincipal() p: Principal) {
    return this.local.readiness(p.tenantId);
  }

  @Put()
  @RequirePermission("tenant.sso.manage")
  update(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.local.updatePolicy(p, parse(UpdateSignInPolicySchema, body), meta);
  }
}
