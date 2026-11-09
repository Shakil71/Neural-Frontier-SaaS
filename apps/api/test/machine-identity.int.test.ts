import { IssuedSecretSchema, TokenResponseSchema } from "@nf/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, seedTenant, signIn, startApp, type TestApp } from "./helpers.js";

let t: TestApp;
let acme: Fixture;
let other: Fixture;

beforeAll(async () => {
  t = await startApp();
  acme = await seedTenant(t, "sp");
  other = await seedTenant(t, "sp-other");
});
afterAll(() => t?.close());

async function createPrincipal(name: string, permissions: string[], tenant = acme) {
  const owner = await signIn(t, tenant.tenantId, tenant.owner);
  const res = await owner
    .post("/api/v1/service-principals")
    .send({ name, description: "integration test", permissions })
    .expect(201);
  return IssuedSecretSchema.parse(res.body);
}

const tokenRequest = () => request(t.http).post("/api/v1/oauth/token");

async function token(clientId: string, clientSecret: string, scope?: string) {
  const res = await tokenRequest()
    .type("form")
    .send({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      ...(scope ? { scope } : {}),
    })
    .expect(200);
  expect(res.headers["cache-control"]).toBe("no-store");
  return TokenResponseSchema.parse(res.body).access_token;
}

const bearer = (tok: string) => ({
  get: (url: string) => request(t.http).get(url).set("Authorization", `Bearer ${tok}`),
  post: (url: string) => request(t.http).post(url).set("Authorization", `Bearer ${tok}`),
});

describe("service principal management", () => {
  it("only the owner can create service principals", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin
      .post("/api/v1/service-principals")
      .send({ name: "x", permissions: ["directory.read"] })
      .expect(403);
    await admin.get("/api/v1/service-principals").expect(200); // admin may view
  });

  it("refuses permissions that could escalate privilege", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    for (const p of [
      "roles.assign",
      "service_principals.manage",
      "identities.manage",
      "connectors.manage",
    ]) {
      await owner
        .post("/api/v1/service-principals")
        .send({ name: `escalate-${p}`, permissions: [p] })
        .expect(400);
    }
  });

  it("returns the secret once and stores only a hash", async () => {
    const issued = await createPrincipal("Secret storage check", ["directory.read"]);
    expect(issued.clientSecret).toMatch(/^nfs_/);
    expect(JSON.stringify(issued.servicePrincipal)).not.toContain(issued.clientSecret);
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const again = await owner
      .get(`/api/v1/service-principals/${issued.servicePrincipal.id}`)
      .expect(200);
    expect(JSON.stringify(again.body)).not.toContain(issued.clientSecret);
  });
});

describe("OAuth client credentials", () => {
  it("issues a token (form or Basic auth) and rejects bad credentials uniformly", async () => {
    const sp = await createPrincipal("Token bot", ["directory.read", "connectors.read"]);
    await token(sp.clientId, sp.clientSecret);

    const basic = Buffer.from(`${sp.clientId}:${sp.clientSecret}`).toString("base64");
    await tokenRequest()
      .set("Authorization", `Basic ${basic}`)
      .type("form")
      .send({ grant_type: "client_credentials" })
      .expect(200);

    for (const [id, secret] of [
      [sp.clientId, `${sp.clientSecret}x`],
      ["nfc_00000000000000000000000000000000", sp.clientSecret],
    ] as const) {
      const res = await tokenRequest()
        .type("form")
        .send({ grant_type: "client_credentials", client_id: id, client_secret: secret })
        .expect(401);
      expect(res.body).toEqual({
        error: "invalid_client",
        error_description: "Client authentication failed",
      });
    }
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const audit = await owner
      .get("/api/v1/audit-events?action=service_principal.auth_failed")
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      outcome: "failure",
      metadata: { reason: "bad_secret" },
    });

    const grant = await tokenRequest()
      .send({ grant_type: "password", client_id: sp.clientId, client_secret: sp.clientSecret })
      .expect(400);
    expect(grant.body.error).toBe("unsupported_grant_type");
  });

  it("a token can only use @MachineAccess routes, within its permissions", async () => {
    const sp = await createPrincipal("Reader bot", ["directory.read"]);
    const api = bearer(await token(sp.clientId, sp.clientSecret));
    await api.get("/api/v1/directory/users").expect(200);
    await api.get("/api/v1/audit-events").expect(403); // no audit.read
    await api.get("/api/v1/auth/session").expect(403); // people-only route
    await api.get("/api/v1/tenant").expect(403);
    await api.post("/api/v1/role-assignments").send({}).expect(403);
    await request(t.http)
      .get("/api/v1/directory/users")
      .set("Authorization", "Bearer garbage")
      .expect(401);
  });

  it("scope can narrow but never widen the grant", async () => {
    const sp = await createPrincipal("Scoped bot", ["directory.read", "connectors.read"]);
    const narrow = bearer(await token(sp.clientId, sp.clientSecret, "directory.read"));
    await narrow.get("/api/v1/directory/users").expect(200);
    await narrow.get("/api/v1/connectors").expect(403);

    const res = await tokenRequest()
      .type("form")
      .send({
        grant_type: "client_credentials",
        client_id: sp.clientId,
        client_secret: sp.clientSecret,
        scope: "directory.read audit.read",
      })
      .expect(400);
    expect(res.body.error).toBe("invalid_scope");
  });

  it("revocation is immediate: secret revoked, principal disabled, permissions reduced", async () => {
    const sp = await createPrincipal("Revocable bot", ["directory.read", "connectors.read"]);
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const id = sp.servicePrincipal.id;

    // Rotation: a second secret works alongside the first.
    const second = IssuedSecretSchema.parse(
      (await owner.post(`/api/v1/service-principals/${id}/secrets`).send({}).expect(201)).body,
    );
    const first = bearer(await token(sp.clientId, sp.clientSecret));
    const next = bearer(await token(sp.clientId, second.clientSecret));
    await first.get("/api/v1/connectors").expect(200);

    // Permission downgrade applies to tokens already issued.
    let current = (await owner.get(`/api/v1/service-principals/${id}`)).body;
    await owner
      .patch(`/api/v1/service-principals/${id}`)
      .send({
        version: current.version,
        permissions: ["directory.read"],
        reason: "least privilege",
      })
      .expect(200);
    await first.get("/api/v1/connectors").expect(403);
    await first.get("/api/v1/directory/users").expect(200);

    // Revoking the first secret kills tokens issued with it, not the rotated one.
    await owner
      .delete(`/api/v1/service-principals/${id}/secrets/${sp.secretId}`)
      .send({ reason: "rotated" })
      .expect(200);
    await first.get("/api/v1/directory/users").expect(401);
    await next.get("/api/v1/directory/users").expect(200);
    await tokenRequest()
      .type("form")
      .send({
        grant_type: "client_credentials",
        client_id: sp.clientId,
        client_secret: sp.clientSecret,
      })
      .expect(401);

    // Disabling the principal stops everything.
    current = (await owner.get(`/api/v1/service-principals/${id}`)).body;
    await owner
      .patch(`/api/v1/service-principals/${id}`)
      .send({ version: current.version, status: "disabled", reason: "incident" })
      .expect(200);
    await next.get("/api/v1/directory/users").expect(401);
  });

  it("a token only ever sees its own tenant", async () => {
    const mine = await createPrincipal("Tenant bot", ["connectors.read"], other);
    const api = bearer(await token(mine.clientId, mine.clientSecret));
    const list = await api.get("/api/v1/connectors").expect(200);
    expect(list.body).toEqual([]);
    const acmeOwner = await signIn(t, acme.tenantId, acme.owner);
    const sps = (await acmeOwner.get("/api/v1/service-principals")).body as { id: string }[];
    expect(sps.some((s) => s.id === mine.servicePrincipal.id)).toBe(false);
  });

  it("a token cannot be used as a session cookie and needs no CSRF token", async () => {
    const sp = await createPrincipal("Sync bot", ["connectors.sync", "connectors.read"]);
    const tok = await token(sp.clientId, sp.clientSecret);
    await request(t.http)
      .get("/api/v1/connectors")
      .set("Cookie", `${t.config.cookie.sessionName}=${tok}`)
      .expect(401);
    // POST with a bearer token: no CSRF header needed; 404 because the connector doesn't exist.
    await bearer(tok)
      .post("/api/v1/connectors/0192f1a0-0000-7000-8000-000000000000/sync")
      .expect(404);
  });
});
