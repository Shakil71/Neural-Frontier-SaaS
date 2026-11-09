import { randomBytes } from "node:crypto";
import { DashboardSummarySchema, HealthReportSchema, IdentitySchema } from "@nf/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProvisioningService } from "../src/modules/auth/provisioning.service.js";
import { type Fixture, seedTenant, signIn, startApp, type TestApp } from "./helpers.js";

let t: TestApp;
let acme: Fixture;

beforeAll(async () => {
  t = await startApp();
  acme = await seedTenant(t, "wf");
});
afterAll(() => t?.close());

const meta = { ipAddress: "127.0.0.1", userAgent: "vitest", requestId: null };

describe("identity lifecycle", () => {
  it("suspends with optimistic concurrency and revokes the identity's sessions", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const memberSession = await signIn(t, acme.tenantId, acme.member);
    await memberSession.get("/api/v1/auth/session").expect(200);

    const before = IdentitySchema.parse(
      (await owner.get(`/api/v1/identities/${acme.member}`).expect(200)).body,
    );

    const stale = await owner
      .patch(`/api/v1/identities/${acme.member}/status`)
      .send({ status: "suspended", version: before.version + 5, reason: "stale write" })
      .expect(409);
    expect(stale.body.error.code).toBe("conflict");

    const res = await owner
      .patch(`/api/v1/identities/${acme.member}/status`)
      .send({ status: "suspended", version: before.version, reason: "left the company" })
      .expect(200);
    expect(res.body.status).toBe("suspended");
    expect(res.body.version).toBe(before.version + 1);

    await memberSession.get("/api/v1/auth/session").expect(401);

    const log = await owner.get("/api/v1/audit-events?action=identity.status_changed").expect(200);
    expect(log.body.items[0]).toMatchObject({
      target: { id: acme.member },
      metadata: { from: "active", to: "suspended", reason: "left the company" },
    });

    await owner
      .patch(`/api/v1/identities/${acme.member}/status`)
      .send({ status: "active", version: res.body.version, reason: "rehired" })
      .expect(200);
  });

  it("an owner cannot suspend themselves", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    await owner
      .patch(`/api/v1/identities/${acme.owner}/status`)
      .send({ status: "suspended", version: 0, reason: "oops" })
      .expect(400);
  });

  it("the last owner role cannot be revoked", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const assignments = await owner
      .get(`/api/v1/identities/${acme.owner}/role-assignments`)
      .expect(200);
    const ownerAssignment = assignments.body.find(
      (a: { roleId: string }) => a.roleId === acme.roles.owner,
    );
    const res = await owner
      .delete(`/api/v1/role-assignments/${ownerAssignment.id}`)
      .send({ reason: "try to orphan the tenant" })
      .expect(409);
    expect(res.body.error.message).toMatch(/at least one active Tenant Owner/);
  });
});

describe("idempotent role assignment", () => {
  it("replays the original result for a retried request and rejects key reuse", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const key = `test-${randomBytes(8).toString("hex")}`;
    const body = {
      identityId: acme.auditor,
      roleId: acme.roles.administrator,
      reason: "covering on-call",
    };

    const first = await owner
      .post("/api/v1/role-assignments")
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const retry = await owner
      .post("/api/v1/role-assignments")
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    expect(retry.body).toEqual(first.body);

    const count = await t.database.system.roleAssignment.count({
      where: {
        tenantId: acme.tenantId,
        identityId: acme.auditor,
        roleId: acme.roles.administrator,
      },
    });
    expect(count).toBe(1);

    await owner
      .post("/api/v1/role-assignments")
      .set("Idempotency-Key", key)
      .send({ ...body, reason: "a different request" })
      .expect(409);

    // Without a key, a duplicate grant is a plain conflict.
    await owner.post("/api/v1/role-assignments").send(body).expect(409);
  });
});

describe("SSO provisioning", () => {
  const issuer = "https://idp.test";
  const provisioning = () => t.app.get(ProvisioningService);

  it("refuses unknown domains and unverified emails, auditing the failure", async () => {
    const unknown = await provisioning().signIn(
      {
        issuer,
        subject: "u1",
        email: "eve@unknown-domain.example",
        emailVerified: true,
        name: "Eve",
      },
      meta,
    );
    expect(unknown).toEqual({ ok: false, reason: "unknown_domain", tenantId: null });

    const unverified = await provisioning().signIn(
      { issuer, subject: "u2", email: `mallory@${acme.domain}`, emailVerified: false, name: "M" },
      meta,
    );
    expect(unverified).toMatchObject({ ok: false, reason: "email_unverified" });
  });

  it("links a pre-provisioned identity on first sign-in, then matches on subject", async () => {
    const subject = `owner-${randomBytes(4).toString("hex")}`;
    const first = await provisioning().signIn(
      { issuer, subject, email: `owner@${acme.domain}`, emailVerified: true, name: "Owner" },
      meta,
    );
    expect(first).toEqual({ ok: true, tenantId: acme.tenantId, identityId: acme.owner });

    // Email changed at the IdP: the bound subject still resolves to the same identity.
    const again = await provisioning().signIn(
      { issuer, subject, email: "renamed@elsewhere.example", emailVerified: true, name: "Owner" },
      meta,
    );
    expect(again).toEqual({ ok: true, tenantId: acme.tenantId, identityId: acme.owner });

    // A different IdP account claiming the same email cannot take it over.
    const hijack = await provisioning().signIn(
      {
        issuer,
        subject: "attacker",
        email: `owner@${acme.domain}`,
        emailVerified: true,
        name: "X",
      },
      meta,
    );
    expect(hijack).toMatchObject({ ok: false, reason: "subject_mismatch" });
  });

  it("auto-provisions new users as Members with no admin access", async () => {
    const email = `new-${randomBytes(4).toString("hex")}@${acme.domain}`;
    const result = await provisioning().signIn(
      { issuer, subject: email, email, emailVerified: true, name: "New Person" },
      meta,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fresh = await signIn(t, acme.tenantId, result.identityId);
    expect(fresh.session.permissions).toEqual([]);
    await fresh.get("/api/v1/identities").expect(403);
  });
});

describe("dashboard", () => {
  it("returns live, contract-valid aggregates", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const summary = DashboardSummarySchema.parse(
      (await owner.get("/api/v1/dashboard/summary").expect(200)).body,
    );
    const total = await t.database.system.identity.count({ where: { tenantId: acme.tenantId } });
    expect(summary.identities.total).toBe(total);
    expect(summary.signIns.daily).toHaveLength(14);
    expect(summary.signIns.last24h).toBeGreaterThanOrEqual(1);
    expect(summary.roleDistribution.find((r) => r.role === "Tenant Owner")?.members).toBe(1);
  });
});

describe("health and operations", () => {
  it("exposes liveness and readiness without detail", async () => {
    await request(t.http).get("/api/health/live").expect(200, { status: "ok", release: "dev" });
    const ready = await request(t.http).get("/api/health/ready").expect(200);
    expect(Object.keys(ready.body).sort()).toEqual(["release", "status"]);
  });

  it("detailed health requires a permission and reports dependencies", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const report = HealthReportSchema.parse(
      (await owner.get("/api/v1/system/health").expect(200)).body,
    );
    expect(report.dependencies.find((d) => d.name === "mysql")?.status).toBe("up");
    // The member holds no permissions (the auditor was promoted earlier in this file).
    const member = await signIn(t, acme.tenantId, acme.member);
    await member.get("/api/v1/system/health").expect(403);
  });

  it("serves metrics to loopback only, never via the proxy", async () => {
    const res = await request(t.http).get("/api/metrics").expect(200);
    expect(res.text).toContain("nf_http_request_duration_seconds");
    await request(t.http).get("/api/metrics").set("X-Forwarded-For", "203.0.113.9").expect(404);
  });

  it("sign-in reports SSO as unconfigured instead of failing obscurely", async () => {
    const res = await request(t.http).get("/api/v1/auth/login").expect(303);
    expect(res.headers.location).toBe("https://nf.test/sign-in?error=sso_not_configured");
  });
});

describe.runIf(process.env.TEST_REDIS_URL)("rate limiting (Redis-backed)", () => {
  it("throttles the sign-in endpoint after 20 requests a minute", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      // Distinct client IP per run (trust proxy = loopback, so X-Forwarded-For is honoured).
      statuses.push(
        (await request(t.http).get("/api/v1/auth/login").set("X-Forwarded-For", ip)).status,
      );
    }
    expect(statuses.slice(0, 20).every((s) => s === 303)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
});
