import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { Errors } from "./errors.js";
import type { Principal, RequestMeta } from "./principal.js";

export function requestMeta(req: Request): RequestMeta {
  const ua = req.get("user-agent");
  return {
    ipAddress: req.ip ?? null,
    userAgent: ua ? ua.slice(0, 512) : null,
    requestId: req.id ? String(req.id) : null,
  };
}

/** Injects the authenticated principal. Throws 401 if the route was reached without one. */
export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.principal) throw Errors.unauthenticated();
    return req.principal;
  },
);

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMeta(ctx.switchToHttp().getRequest<Request>()),
);

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Accept an upstream request id only if it is well-formed; otherwise mint one. */
export function resolveRequestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && REQUEST_ID.test(value) ? value : crypto.randomUUID();
}
