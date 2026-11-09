import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { bootstrapTenant } from "@nf/db";
import request from "supertest";
import { createApp } from "../src/bootstrap.js";
import { type AppConfig, loadConfig } from "../src/config/config.js";
import { DatabaseService } from "../src/infra/database.service.js";
import { SessionService } from "../src/modules/auth/session.service.js";

export const PUBLIC_URL = "https://nf.test";

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    REDIS_URL: process.env.TEST_REDIS_URL,
    NF_PUBLIC_URL: PUBLIC_URL,
    NF_SESSION_SECRET: "integration-test-secret-integration-test",
    LOG_LEVEL: "silent",
    ...overrides,
  });
}

export interface TestApp {
  app: INestApplication;
  http: ReturnType<INestApplication["getHttpServer"]>;
  config: AppConfig;
  database: DatabaseService;
  close(): Promise<void>;
}

export async function startApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const config = testConfig(overrides);
  const app = await createApp(config, { bufferLogs: false });
  app.useLogger(false);
  await app.init();
  return {
    app,
    http: app.getHttpServer(),
    config,
    database: app.get(DatabaseService),
    close: () => app.close(),
  };
}

export interface Fixture {
  tenantId: string;
  domain: string;
  owner: string;
  admin: string;
  auditor: string;
  member: string;
  roles: Record<"owner" | "administrator" | "security_auditor" | "member", string>;
}

/** A fresh, isolated tenant with one identity per built-in role. */
export async function seedTenant(t: TestApp, label: string): Promise<Fixture> {
  const suffix = randomBytes(4).toString("hex");
  const domain = `${label}-${suffix}.example`;
  const { tenantId, ownerId } = await bootstrapTenant(t.database.system, {
    tenantName: `${label} ${suffix}`,
    tenantSlug: `${label}-${suffix}`,
    domain,
    ownerEmail: `owner@${domain}`,
    ownerName: `${label} Owner`,
  });
  const roles = await t.database.system.role.findMany({ where: { tenantId } });
  const roleId = Object.fromEntries(roles.map((r) => [r.key, r.id])) as Fixture["roles"];

  async function person(local: string, role: keyof Fixture["roles"]) {
    const identity = await t.database.system.identity.create({
      data: { tenantId, email: `${local}@${domain}`, displayName: `${label} ${local}` },
    });
    await t.database.system.roleAssignment.create({
      data: { tenantId, identityId: identity.id, roleId: roleId[role], reason: "test fixture" },
    });
    return identity.id;
  }

  return {
    tenantId,
    domain,
    owner: ownerId,
    admin: await person("admin", "administrator"),
    auditor: await person("auditor", "security_auditor"),
    member: await person("member", "member"),
    roles: roleId,
  };
}

/** Signed-in HTTP client for an identity: session cookie + CSRF token, same-origin. */
export async function signIn(t: TestApp, tenantId: string, identityId: string) {
  const { token } = await t.app
    .get(SessionService)
    .create(tenantId, identityId, { ipAddress: "127.0.0.1", userAgent: "vitest", requestId: null });
  const cookie = `${t.config.cookie.sessionName}=${token}`;
  const session = await request(t.http)
    .get("/api/v1/auth/session")
    .set("Cookie", cookie)
    .expect(200);
  const csrf = session.body.csrfToken as string;

  return {
    token,
    session: session.body,
    get: (url: string) => request(t.http).get(url).set("Cookie", cookie),
    post: (url: string) =>
      request(t.http)
        .post(url)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrf)
        .set("Origin", PUBLIC_URL),
    patch: (url: string) =>
      request(t.http)
        .patch(url)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrf)
        .set("Origin", PUBLIC_URL),
    put: (url: string) =>
      request(t.http)
        .put(url)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrf)
        .set("Origin", PUBLIC_URL),
    delete: (url: string) =>
      request(t.http)
        .delete(url)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrf)
        .set("Origin", PUBLIC_URL),
    /** Same session, but without the CSRF header — for negative tests. */
    raw: { patch: (url: string) => request(t.http).patch(url).set("Cookie", cookie) },
  };
}
