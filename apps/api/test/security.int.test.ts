import {
  AuditEventSchema,
  IdentitySchema,
  RoleSchema,
  SessionSchema,
  type Identity,
} from "@nf/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, seedTenant, signIn, startApp, type TestApp } from "./helpers.js";

let t: TestApp;
let acme: Fixture;
let globex: Fixture;

beforeAll(async () => {
  t = await startApp();
  acme = await seedTenant(t, "acme");
  globex = await seedTenant(t, "globex");
});
afterAll(() => t?.close());

describe("authentication", () => {
  it("rejects requests without a session", async () => {
    const res = await request(t.http).get("/api/v1/identities").expect(401);
    expect(res.body.error.code).toBe("unauthenticated");
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.headers["x-request-id"]).toBe(res.body.error.requestId);
  });

  it("rejects a forged session cookie", async () => {
    await request(t.http)
      .get("/api/v1/identities")
      .set("Cookie", `${t.config.cookie.sessionName}=forged-token-value`)
      .expect(401);
  });

  it("returns a contract-valid session with the owner's permissions", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const session = SessionSchema.parse(owner.session);
    expect(session.tenant.id).toBe(acme.tenantId);
    expect(session.permissions).toContain("roles.assign");
  });

  it("ends the session on logout", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    await owner.post("/api/v1/auth/logout").expect(204);
    await owner.get("/api/v1/auth/session").expect(401);
  });
});

describe("tenant isolation", () => {
  it("lists only the caller's tenant identities", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const res = await owner.get("/api/v1/identities?limit=100").expect(200);
    const items = res.body.items as Identity[];
    items.forEach((i) => IdentitySchema.parse(i));
    expect(items.map((i) => i.id).sort()).toEqual(
      [acme.owner, acme.admin, acme.auditor, acme.member].sort(),
    );
    expect(items.every((i) => i.email.endsWith(`@${acme.domain}`))).toBe(true);
  });

  it("cannot read, modify or grant roles to another tenant's identity", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    await owner.get(`/api/v1/identities/${globex.member}`).expect(404);
    await owner
      .patch(`/api/v1/identities/${globex.member}/status`)
      .send({ status: "suspended", version: 0, reason: "cross-tenant attempt" })
      .expect(404);
    await owner
      .post("/api/v1/role-assignments")
      .send({ identityId: globex.member, roleId: acme.roles.owner, reason: "cross-tenant attempt" })
      .expect(404);
    await owner
      .post("/api/v1/role-assignments")
      .send({ identityId: acme.member, roleId: globex.roles.owner, reason: "cross-tenant attempt" })
      .expect(404);
  });

  it("the database refuses a cross-tenant role assignment even if code is bypassed", async () => {
    await expect(
      t.database.system.roleAssignment.create({
        data: {
          tenantId: acme.tenantId,
          identityId: acme.member,
          roleId: globex.roles.owner,
          reason: "bypass",
        },
      }),
    ).rejects.toThrow();
  });

  it("the tenant guard refuses an unscoped query", async () => {
    await expect(t.database.db.identity.findMany({})).rejects.toThrow(/Tenant scope violation/);
  });

  it("audit log shows only the caller's tenant", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const res = await owner.get("/api/v1/audit-events?limit=100").expect(200);
    for (const e of res.body.items) AuditEventSchema.parse(e);
    const globexIds = new Set([globex.owner, globex.admin, globex.auditor, globex.member]);
    expect(
      res.body.items.some(
        (e: { target: { id: string } | null }) => e.target && globexIds.has(e.target.id),
      ),
    ).toBe(false);
  });
});

describe("role-based access control", () => {
  it("auditor can read but not change identities, and the denial is audited", async () => {
    const auditor = await signIn(t, acme.tenantId, acme.auditor);
    await auditor.get("/api/v1/identities").expect(200);
    const denied = await auditor
      .patch(`/api/v1/identities/${acme.member}/status`)
      .send({ status: "suspended", version: 0, reason: "should be denied" })
      .expect(403);
    expect(denied.body.error.code).toBe("forbidden");

    const owner = await signIn(t, acme.tenantId, acme.owner);
    const log = await owner
      .get(`/api/v1/audit-events?action=authz.denied&actorId=${acme.auditor}`)
      .expect(200);
    expect(log.body.items[0].metadata.permission).toBe("identities.manage");
  });

  it("member has no administrative access", async () => {
    const member = await signIn(t, acme.tenantId, acme.member);
    await member.get("/api/v1/identities").expect(403);
    await member.get("/api/v1/audit-events").expect(403);
    await member.get("/api/v1/dashboard/summary").expect(403);
    await member.get("/api/v1/auth/session").expect(200);
  });

  it("administrator cannot grant roles (separation of duties)", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin
      .post("/api/v1/role-assignments")
      .send({ identityId: acme.member, roleId: acme.roles.owner, reason: "privilege escalation" })
      .expect(403);
  });

  it("role revocation takes effect on the very next request", async () => {
    const extra = await t.database.system.identity.create({
      data: { tenantId: acme.tenantId, email: `temp-auditor@${acme.domain}`, displayName: "Temp" },
    });
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const grant = await owner
      .post("/api/v1/role-assignments")
      .send({
        identityId: extra.id,
        roleId: acme.roles.security_auditor,
        reason: "temporary audit access",
      })
      .expect(201);
    const temp = await signIn(t, acme.tenantId, extra.id);
    await temp.get("/api/v1/audit-events").expect(200);
    await owner
      .delete(`/api/v1/role-assignments/${grant.body.id}`)
      .send({ reason: "audit finished" })
      .expect(204);
    await temp.get("/api/v1/audit-events").expect(403);
  });

  it("lists roles with member counts", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const res = await owner.get("/api/v1/roles").expect(200);
    const roles = res.body.map((r: unknown) => RoleSchema.parse(r));
    expect(roles.find((r: { key: string }) => r.key === "owner").memberCount).toBe(1);
  });
});

describe("CSRF and origin protection", () => {
  it("refuses a state change without the CSRF token", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const res = await owner.raw
      .patch(`/api/v1/identities/${acme.member}/status`)
      .send({ status: "suspended", version: 0, reason: "csrf test" })
      .expect(403);
    expect(res.body.error.message).toMatch(/CSRF/);
  });

  it("refuses a cross-origin state change", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    await owner
      .patch(`/api/v1/identities/${acme.member}/status`)
      .set("Origin", "https://evil.example")
      .send({ status: "suspended", version: 0, reason: "csrf test" })
      .expect(403);
  });
});

describe("validation", () => {
  it("returns field-level errors for invalid input", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const res = await owner
      .patch(`/api/v1/identities/${acme.member}/status`)
      .send({ status: "deleted", version: -1 })
      .expect(400);
    expect(res.body.error.code).toBe("validation_failed");
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(["reason", "status", "version"]);
  });

  it("rejects a malformed id before touching the database", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    await owner.get("/api/v1/identities/not-a-uuid").expect(400);
  });
});
