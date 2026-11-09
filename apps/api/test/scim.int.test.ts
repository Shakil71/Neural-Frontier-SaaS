import { IssuedScimTokenSchema } from "@nf/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, seedTenant, signIn, startApp, type TestApp } from "./helpers.js";

let t: TestApp;
let acme: Fixture;
let other: Fixture;
let token: string;

beforeAll(async () => {
  t = await startApp();
  acme = await seedTenant(t, "scim");
  other = await seedTenant(t, "scim-other");
  const owner = await signIn(t, acme.tenantId, acme.owner);
  token = IssuedScimTokenSchema.parse(
    (await owner.post("/api/v1/tenant/scim-tokens").send({ name: "Entra ID" }).expect(201)).body,
  ).token;
});
afterAll(() => t?.close());

const scim = (tok = token) => ({
  get: (url: string) =>
    request(t.http).get(`/api/scim/v2${url}`).set("Authorization", `Bearer ${tok}`),
  post: (url: string, body: unknown) =>
    request(t.http)
      .post(`/api/scim/v2${url}`)
      .set("Authorization", `Bearer ${tok}`)
      .set("Content-Type", "application/scim+json")
      .send(JSON.stringify(body)),
  put: (url: string, body: unknown) =>
    request(t.http)
      .put(`/api/scim/v2${url}`)
      .set("Authorization", `Bearer ${tok}`)
      .set("Content-Type", "application/scim+json")
      .send(JSON.stringify(body)),
  patch: (url: string, body: unknown) =>
    request(t.http)
      .patch(`/api/scim/v2${url}`)
      .set("Authorization", `Bearer ${tok}`)
      .set("Content-Type", "application/scim+json")
      .send(JSON.stringify(body)),
  delete: (url: string) =>
    request(t.http).delete(`/api/scim/v2${url}`).set("Authorization", `Bearer ${tok}`),
});

const userBody = (email: string, extra: Record<string, unknown> = {}) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: email,
  externalId: `ext-${email}`,
  name: { givenName: "Linus", familyName: "Pauling" },
  emails: [{ value: email, type: "work", primary: true }],
  active: true,
  ...extra,
});

describe("SCIM tokens", () => {
  it("only the owner can issue them; the token is returned once", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin.post("/api/v1/tenant/scim-tokens").send({ name: "nope" }).expect(403);
    const list = await admin.get("/api/v1/tenant/scim-tokens").expect(200);
    expect(list.body.baseUrl).toBe("https://nf.test/api/scim/v2");
    expect(JSON.stringify(list.body)).not.toContain(token);
  });

  it("SCIM refuses missing, malformed and session credentials with RFC 7644 errors", async () => {
    const res = await request(t.http).get("/api/scim/v2/Users").expect(401);
    expect(res.headers["content-type"]).toMatch(/application\/scim\+json/);
    expect(res.body).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "401",
    });
    await scim("nfscim_" + "A".repeat(43))
      .get("/Users")
      .expect(401);
    const session = await signIn(t, acme.tenantId, acme.owner);
    await request(t.http)
      .get("/api/scim/v2/Users")
      .set("Cookie", `${t.config.cookie.sessionName}=${session.token}`)
      .expect(401);
  });

  it("publishes its capabilities", async () => {
    const res = await scim().get("/ServiceProviderConfig").expect(200);
    expect(res.body).toMatchObject({ patch: { supported: true }, bulk: { supported: false } });
  });
});

describe("SCIM users", () => {
  let userId: string;
  const email = () => `linus@${acme.domain}`;

  it("creates a Member identity managed by SCIM", async () => {
    const res = await scim().post("/Users", userBody(email())).expect(201);
    userId = res.body.id;
    expect(res.body).toMatchObject({
      userName: email(),
      displayName: "Linus Pauling",
      externalId: `ext-${email()}`,
      active: true,
      meta: { resourceType: "User" },
    });
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const identity = (await owner.get(`/api/v1/identities/${userId}`).expect(200)).body;
    expect(identity).toMatchObject({ source: "scim", roles: [{ key: "member" }] });
    const audit = await owner.get("/api/v1/audit-events?action=identity.provisioned").expect(200);
    expect(audit.body.items[0]).toMatchObject({
      actor: { label: "scim:Entra ID" },
      metadata: { via: "scim" },
    });
  });

  it("rejects duplicates and addresses outside the verified domains", async () => {
    const dup = await scim().post("/Users", userBody(email())).expect(409);
    expect(dup.body.scimType).toBe("uniqueness");
    const foreign = await scim()
      .post("/Users", userBody(`x@${other.domain}`))
      .expect(400);
    expect(foreign.body.scimType).toBe("invalidValue");
  });

  it("filters by userName and externalId, and rejects unsupported filters", async () => {
    const byName = await scim()
      .get(`/Users?filter=${encodeURIComponent(`userName eq "${email()}"`)}`)
      .expect(200);
    expect(byName.body).toMatchObject({ totalResults: 1, Resources: [{ id: userId }] });
    const byExt = await scim()
      .get(`/Users?filter=${encodeURIComponent(`externalId eq "ext-${email()}"`)}`)
      .expect(200);
    expect(byExt.body.totalResults).toBe(1);
    const none = await scim()
      .get(`/Users?filter=${encodeURIComponent('userName eq "nobody@nowhere.example"')}`)
      .expect(200);
    expect(none.body).toMatchObject({ totalResults: 0, Resources: [] });
    const bad = await scim()
      .get(`/Users?filter=${encodeURIComponent('title co "x"')}`)
      .expect(400);
    expect(bad.body.scimType).toBe("invalidFilter");
  });

  it("deactivation from the provider (Entra-style PATCH) suspends and ends sessions at once", async () => {
    const session = await signIn(t, acme.tenantId, userId);
    await session.get("/api/v1/auth/session").expect(200);

    const res = await scim()
      .patch(`/Users/${userId}`, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "Replace", path: "active", value: "False" }],
      })
      .expect(200);
    expect(res.body.active).toBe(false);
    await session.get("/api/v1/auth/session").expect(401);

    const owner = await signIn(t, acme.tenantId, acme.owner);
    const audit = await owner
      .get("/api/v1/audit-events?action=identity.status_changed")
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      target: { id: userId },
      metadata: { from: "active", to: "suspended", via: "scim" },
    });
  });

  it("reactivates and renames with a path-less PATCH, and replaces with PUT", async () => {
    const patched = await scim()
      .patch(`/Users/${userId}`, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", value: { active: true, displayName: "Dr. Linus Pauling" } }],
      })
      .expect(200);
    expect(patched.body).toMatchObject({ active: true, displayName: "Dr. Linus Pauling" });

    const replaced = await scim()
      .put(
        `/Users/${userId}`,
        userBody(email(), { displayName: "L. Pauling", externalId: "ext-2" }),
      )
      .expect(200);
    expect(replaced.body).toMatchObject({ displayName: "L. Pauling", externalId: "ext-2" });
  });

  it("DELETE deactivates (keeps the identity for the audit trail)", async () => {
    await scim().delete(`/Users/${userId}`).expect(204);
    const res = await scim().get(`/Users/${userId}`).expect(200);
    expect(res.body.active).toBe(false);
  });

  it("refuses to deactivate the last Tenant Owner", async () => {
    const res = await scim()
      .patch(`/Users/${acme.owner}`, {
        Operations: [{ op: "replace", path: "active", value: false }],
      })
      .expect(409);
    expect(res.body.detail).toMatch(/last active Tenant Owner/);
  });

  it("a token only sees its own tenant", async () => {
    await scim().get(`/Users/${other.owner}`).expect(404);
    await scim()
      .patch(`/Users/${other.owner}`, {
        Operations: [{ op: "replace", path: "active", value: false }],
      })
      .expect(404);
    const all = await scim().get("/Users?count=100").expect(200);
    expect(
      all.body.Resources.every((u: { userName: string }) => u.userName.endsWith(acme.domain)),
    ).toBe(true);
  });

  it("revoking the token cuts the client off immediately", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const issued = IssuedScimTokenSchema.parse(
      (await owner.post("/api/v1/tenant/scim-tokens").send({ name: "temp" }).expect(201)).body,
    );
    await scim(issued.token).get("/Users").expect(200);
    await owner
      .delete(`/api/v1/tenant/scim-tokens/${issued.scimToken.id}`)
      .send({ reason: "rotation" })
      .expect(200);
    await scim(issued.token).get("/Users").expect(401);
  });
});
