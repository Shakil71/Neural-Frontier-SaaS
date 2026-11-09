import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@nf/contracts";
import type { Request } from "express";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { Errors } from "../../common/errors.js";
import { requestMeta } from "../../common/request.js";
import { AuditService } from "../audit/audit.service.js";
import { PERMISSION_KEY, PUBLIC_KEY } from "../authz/decorators.js";
import { SessionService } from "./session.service.js";
import { csrfTokenFor, safeEqual } from "./tokens.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Global guard, applied to every route in this order:
 * 1. Authentication: a valid session cookie (unless the route is @Public()).
 * 2. CSRF: state-changing requests need a same-origin Origin and the session's CSRF token.
 * 3. Authorization: the @RequirePermission() permission, checked against fresh role data.
 * Deny-by-default: a route with neither @Public() nor a session is unreachable.
 */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[this.config.cookie.sessionName];
    const principal = typeof token === "string" ? await this.sessions.resolve(token) : null;
    if (!principal) throw Errors.unauthenticated();
    req.principal = principal;

    if (!SAFE_METHODS.has(req.method)) {
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
    if (required && !principal.permissions.has(required)) {
      await this.audit.record({
        tenantId: principal.tenantId,
        action: "authz.denied",
        outcome: "denied",
        actor: { id: principal.identityId, label: principal.email },
        meta: requestMeta(req),
        metadata: { permission: required, method: req.method, route: req.route?.path ?? req.path },
      });
      throw Errors.forbidden();
    }
    return true;
  }
}
