import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@nf/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../config/config.js";
import { AppError } from "../../common/errors.js";
import type { Principal } from "../../common/principal.js";
import type { AuditService } from "../audit/audit.service.js";
import { PERMISSION_KEY, PUBLIC_KEY } from "../authz/decorators.js";
import { SecurityGuard } from "./security.guard.js";
import type { SessionService } from "./session.service.js";
import { csrfTokenFor } from "./tokens.js";

const config = loadConfig({
  DATABASE_URL: "mysql://u:p@127.0.0.1/nf",
  NF_PUBLIC_URL: "https://nf.example.com",
  NF_SESSION_SECRET: "k".repeat(40),
});

const principal: Principal = {
  sessionId: "0192f1a0-0000-7000-8000-00000000000a",
  identityId: "0192f1a0-0000-7000-8000-00000000000b",
  tenantId: "0192f1a0-0000-7000-8000-00000000000c",
  email: "ada@acme.example",
  displayName: "Ada",
  permissions: new Set<Permission>(["identities.read"]),
  sessionExpiresAt: new Date(Date.now() + 3_600_000),
};

function context(opts: {
  method?: string;
  cookie?: string;
  headers?: Record<string, string>;
  meta?: Record<string, unknown>;
}): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const headers = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const req: Record<string, unknown> = {
    method: opts.method ?? "GET",
    cookies: opts.cookie ? { [config.cookie.sessionName]: opts.cookie } : {},
    get: (h: string) => headers[h.toLowerCase()],
    path: "/api/test",
  };
  const handler = () => undefined;
  for (const [k, v] of Object.entries(opts.meta ?? {})) Reflect.defineMetadata(k, v, handler);
  const ctx = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe("SecurityGuard", () => {
  let resolve: ReturnType<typeof vi.fn>;
  let record: ReturnType<typeof vi.fn>;
  let guard: SecurityGuard;

  beforeEach(() => {
    resolve = vi.fn(async (token: string) => (token === "good" ? principal : null));
    record = vi.fn(async () => undefined);
    guard = new SecurityGuard(
      new Reflector(),
      config,
      { resolve } as unknown as SessionService,
      { record } as unknown as AuditService,
    );
  });

  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return "allowed";
    } catch (e) {
      return e instanceof AppError ? e.code : "other";
    }
  };

  it("lets @Public routes through without a session", async () => {
    expect(await guard.canActivate(context({ meta: { [PUBLIC_KEY]: true } }).ctx)).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects missing and unknown sessions (deny by default)", async () => {
    expect(await code(guard.canActivate(context({}).ctx))).toBe("unauthenticated");
    expect(await code(guard.canActivate(context({ cookie: "forged" }).ctx))).toBe(
      "unauthenticated",
    );
  });

  it("attaches the principal for a valid session", async () => {
    const { ctx, req } = context({ cookie: "good" });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(req.principal).toBe(principal);
  });

  it("requires the session-bound CSRF token on state-changing requests", async () => {
    expect(await code(guard.canActivate(context({ method: "PATCH", cookie: "good" }).ctx))).toBe(
      "forbidden",
    );
    const wrong = { "x-csrf-token": csrfTokenFor(config.sessionSecret, "another-session") };
    expect(
      await code(
        guard.canActivate(context({ method: "POST", cookie: "good", headers: wrong }).ctx),
      ),
    ).toBe("forbidden");
    const right = { "x-csrf-token": csrfTokenFor(config.sessionSecret, principal.sessionId) };
    expect(
      await guard.canActivate(context({ method: "POST", cookie: "good", headers: right }).ctx),
    ).toBe(true);
  });

  it("refuses cross-origin state-changing requests even with a valid token", async () => {
    const headers = {
      "x-csrf-token": csrfTokenFor(config.sessionSecret, principal.sessionId),
      origin: "https://evil.example",
    };
    expect(
      await code(guard.canActivate(context({ method: "DELETE", cookie: "good", headers }).ctx)),
    ).toBe("forbidden");
  });

  it("enforces @RequirePermission and audits the denial", async () => {
    const ok = context({ cookie: "good", meta: { [PERMISSION_KEY]: "identities.read" } });
    expect(await guard.canActivate(ok.ctx)).toBe(true);

    const denied = context({ cookie: "good", meta: { [PERMISSION_KEY]: "roles.assign" } });
    expect(await code(guard.canActivate(denied.ctx))).toBe("forbidden");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "authz.denied",
        outcome: "denied",
        tenantId: principal.tenantId,
        metadata: expect.objectContaining({ permission: "roles.assign" }),
      }),
    );
  });
});
