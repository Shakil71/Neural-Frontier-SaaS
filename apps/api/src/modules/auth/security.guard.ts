import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@nf/contracts";
import type { Request } from "express";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { Errors } from "../../common/errors.js";
import type { Principal } from "../../common/principal.js";
import { requestMeta } from "../../common/request.js";
import { AuditService } from "../audit/audit.service.js";
import { MACHINE_ACCESS_KEY, PERMISSION_KEY, PUBLIC_KEY } from "../authz/decorators.js";
import { SessionService } from "./session.service.js";
import { csrfTokenFor, safeEqual } from "./tokens.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Resolves OAuth bearer tokens to service principals. Implemented in machine-identity. */
export abstract class BearerResolver {
  abstract resolveBearer(token: string): Promise<Principal | null>;
}

/**
 * Global guard, applied to every route in this order:
 * 1. Authentication: a session cookie (people) or an `Authorization: Bearer` access token
 *    (service principals), unless the route is @Public().
 * 2. CSRF (cookie sessions only): state-changing requests need a same-origin Origin and the
 *    session's CSRF token. Bearer tokens are not sent automatically by browsers, so they
 *    need no CSRF defence.
 * 3. Machine access: service principals may only call routes marked @MachineAccess().
 * 4. Authorization: the @RequirePermission() permission, checked against fresh data.
 * Deny-by-default: a route with neither @Public() nor a valid credential is unreachable.
 */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly bearer: BearerResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const authorization = req.get("authorization");
    let principal: Principal | null;
    if (authorization !== undefined) {
      // An Authorization header means a machine caller; never fall back to the cookie.
      const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization);
      principal = match ? await this.bearer.resolveBearer(match[1]!) : null;
      if (!principal) throw Errors.unauthenticated("Invalid or expired access token");
    } else {
      const token = req.cookies?.[this.config.cookie.sessionName];
      principal = typeof token === "string" ? await this.sessions.resolve(token) : null;
      if (!principal) throw Errors.unauthenticated();
    }
    req.principal = principal;

    if (principal.kind === "user" && !SAFE_METHODS.has(req.method)) {
      const origin = req.get("origin");
      if (origin && origin !== this.config.publicUrl.origin)
        throw Errors.forbidden("Cross-origin request refused");
      const sent = req.get("x-csrf-token") ?? "";
      if (!safeEqual(sent, csrfTokenFor(this.config.sessionSecret, principal.sessionId))) {
        throw Errors.forbidden("Missing or invalid CSRF token");
      }
    }

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    const machineAllowed =
      principal.kind === "user" ||
      this.reflector.getAllAndOverride<boolean>(MACHINE_ACCESS_KEY, targets) === true;

    if (!machineAllowed || (required && !principal.permissions.has(required))) {
      await this.audit.record({
        tenantId: principal.tenantId,
        action: "authz.denied",
        outcome: "denied",
        actor: { id: principal.identityId, label: principal.email },
        meta: requestMeta(req),
        metadata: {
          ...(required ? { permission: required } : {}),
          ...(!machineAllowed ? { reason: "route_not_available_to_service_principals" } : {}),
          method: req.method,
          route: req.route?.path ?? req.path,
        },
      });
      throw Errors.forbidden();
    }
    return true;
  }
}
