import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TenantIdentityProviderSchema } from "@nf/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderContext } from "../src/modules/auth/oidc.service.js";
import { ProvisioningService } from "../src/modules/auth/provisioning.service.js";
import { type Fixture, seedTenant, signIn, startApp, type TestApp } from "./helpers.js";

/** Serves just enough of an OIDC provider for discovery (the real redirect flow is in E2E). */
async function startIssuer(): Promise<{ url: string; close: () => Promise<void> }> {
  let base = "";
  const server: Server = createServer((req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: `${base}/auth`,
          token_endpoint: `${base}/token`,
          jwks_uri: `${base}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: base, close: () => new Promise((r) => server.close(() => r())) };
}

let t: TestApp;
let issuer: { url: string; close: () => Promise<void> };
let shared: { url: string; close: () => Promise<void> };
let acme: Fixture;
let other: Fixture;
const meta = { ipAddress: "127.0.0.1", userAgent: "vitest", requestId: null };

beforeAll(async () => {
  issuer = await startIssuer();
  shared = await startIssuer();
  t = await startApp({
    NF_DATA_KEY: randomBytes(32).toString("base64"),
    NF_OIDC_ALLOW_INSECURE_HTTP: "true",
    // The deployment-wide provider every tenant can use unless it requires its own.
    NF_OIDC_ISSUER: shared.url,
    NF_OIDC_CLIENT_ID: "shared-app",
    NF_OIDC_CLIENT_SECRET: "shared-secret",
  });
  acme = await seedTenant(t, "idp");
  other = await seedTenant(t, "idp-other");
});
afterAll(async () => {
  await t?.close();
  await issuer?.close();
  await shared?.close();
});

const provisioning = () => t.app.get(ProvisioningService);
const tenantProvider = (tenantId: string): ProviderContext => ({
  key: `tenant:${tenantId}`,
  tenantId,
  requireEmailVerified: true,
});
const claims = (email: string, iss: string, sub = email) => ({
  issuer: iss,
  subject: sub,
  email,
  emailVerified: true,
  name: null,
});

async function configure(fixture: Fixture) {
  const owner = await signIn(t, fixture.tenantId, fixture.owner);
  const res = await owner
    .put("/api/v1/tenant/identity-provider")
    .send({ issuer: issuer.url, clientId: "acme-app", clientSecret: "acme-secret-value" })
    .expect(200);
  return TenantIdentityProviderSchema.parse(res.body);
}

describe("configuring a tenant's own provider", () => {
  it("is owner-only", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin
      .put("/api/v1/tenant/identity-provider")
      .send({ issuer: issuer.url, clientId: "x", clientSecret: "y" })
      .expect(403);
  });

  it("validates the issuer by discovery before saving anything", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const res = await owner
      .put("/api/v1/tenant/identity-provider")
      .send({ issuer: "http://127.0.0.1:1/nope", clientId: "x", clientSecret: "y" })
      .expect(400);
    expect(res.body.error.message).toMatch(/openid-configuration/);
    expect((await owner.get("/api/v1/tenant/identity-provider").expect(200)).body).toEqual({
      identityProvider: null,
    });
  });

  it("stores the secret sealed and never returns it; the change is audited", async () => {
    const idp = await configure(acme);
    expect(idp).toMatchObject({
      clientId: "acme-app",
      enforcement: "optional",
      secretHint: "••••alue",
    });
    expect(JSON.stringify(idp)).not.toContain("acme-secret-value");
    const row = await t.database.system.tenantIdentityProvider.findUniqueOrThrow({
      where: { tenantId: acme.tenantId },
    });
    expect(Buffer.from(row.secretCiphertext).includes(Buffer.from("acme-secret-value"))).toBe(
      false,
    );
    const owner = await signIn(t, acme.tenantId, acme.owner);
    const audit = await owner.get("/api/v1/audit-events?action=tenant.idp_configured").expect(200);
    expect(audit.body.items[0]).toMatchObject({
      metadata: { created: true, clientId: "acme-app" },
    });
  });

  it("email-first sign-in sends the tenant's people to their provider, with a login hint", async () => {
    const res = await request(t.http)
      .get(`/api/v1/auth/login?email=${encodeURIComponent(`someone@${acme.domain}`)}`)
      .expect(303);
    const location = new URL(res.headers.location as string);
    expect(location.origin + location.pathname).toBe(`${issuer.url}/auth`);
    expect(location.searchParams.get("client_id")).toBe("acme-app");
    expect(location.searchParams.get("login_hint")).toBe(`someone@${acme.domain}`);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");

    // A tenant without its own provider (and an empty email) use the shared provider.
    for (const q of [`?email=${encodeURIComponent(`x@${other.domain}`)}`, ""]) {
      const res2 = await request(t.http).get(`/api/v1/auth/login${q}`).expect(303);
      expect((res2.headers.location as string).startsWith(`${shared.url}/auth?`)).toBe(true);
      expect(new URL(res2.headers.location as string).searchParams.get("client_id")).toBe(
        "shared-app",
      );
    }
  });

  it("refuses the deployment's shared provider as a tenant provider", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    await owner
      .put("/api/v1/tenant/identity-provider")
      .send({ issuer: shared.url, clientId: "x", clientSecret: "y" })
      .expect(400);
  });
});

describe("sign-in rules for tenant providers", () => {
  it("a tenant's provider can't sign anyone in to another tenant", async () => {
    const elsewhere = await provisioning().signIn(
      claims(`owner@${other.domain}`, issuer.url),
      meta,
      tenantProvider(acme.tenantId),
    );
    expect(elsewhere).toMatchObject({ ok: false, reason: "idp_tenant_mismatch" });

    const unknownDomain = await provisioning().signIn(
      claims("mallory@unregistered.example", issuer.url),
      meta,
      tenantProvider(acme.tenantId),
    );
    expect(unknownDomain).toMatchObject({ ok: false, reason: "idp_tenant_mismatch" });
  });

  it("moves an identity from the shared provider to the tenant's provider on first sign-in", async () => {
    const email = `mover@${acme.domain}`;
    const viaShared = await provisioning().signIn(claims(email, "https://shared.example"), meta);
    expect(viaShared.ok).toBe(true);

    // Same issuer, different subject: still a hijack attempt.
    const hijack = await provisioning().signIn(
      claims(email, "https://shared.example", "someone-else"),
      meta,
    );
    expect(hijack).toMatchObject({ ok: false, reason: "subject_mismatch" });

    const moved = await provisioning().signIn(
      claims(email, issuer.url, "tenant-idp-subject"),
      meta,
      tenantProvider(acme.tenantId),
    );
    expect(moved).toMatchObject({ ok: true, tenantId: acme.tenantId });
    const identity = await t.database.system.identity.findFirstOrThrow({ where: { email } });
    expect(identity).toMatchObject({ oidcIssuer: issuer.url, oidcSubject: "tenant-idp-subject" });

    // The shared provider can't take it back.
    const back = await provisioning().signIn(claims(email, "https://shared.example"), meta);
    expect(back).toMatchObject({ ok: false, reason: "subject_mismatch" });
  });

  it("a bound account can't be used through another tenant's provider", async () => {
    await configure(other);
    const res = await provisioning().signIn(
      claims(`mover@${acme.domain}`, issuer.url, "tenant-idp-subject"),
      meta,
      tenantProvider(other.tenantId),
    );
    expect(res).toMatchObject({ ok: false, reason: "idp_tenant_mismatch" });
  });
});

describe("requiring the tenant's provider", () => {
  it("is refused until the owner has signed in through it, then blocks the shared provider", async () => {
    const owner = await signIn(t, acme.tenantId, acme.owner);
    let idp = TenantIdentityProviderSchema.parse(
      (await owner.get("/api/v1/tenant/identity-provider")).body.identityProvider,
    );
    const refused = await owner
      .patch("/api/v1/tenant/identity-provider/enforcement")
      .send({ enforcement: "required", version: idp.version, reason: "single front door" })
      .expect(409);
    expect(refused.body.error.message).toMatch(/sign in once/i);

    // The owner signs in through the tenant's provider (proving it works).
    const ownerEmail = `owner@${acme.domain}`;
    expect(
      await provisioning().signIn(
        claims(ownerEmail, issuer.url, "owner-sub"),
        meta,
        tenantProvider(acme.tenantId),
      ),
    ).toMatchObject({ ok: true });

    idp = TenantIdentityProviderSchema.parse(
      (
        await owner
          .patch("/api/v1/tenant/identity-provider/enforcement")
          .send({ enforcement: "required", version: idp.version, reason: "single front door" })
          .expect(200)
      ).body,
    );
    expect(idp.enforcement).toBe("required");

    const viaShared = await provisioning().signIn(
      claims(`newcomer@${acme.domain}`, "https://shared.example"),
      meta,
    );
    expect(viaShared).toMatchObject({ ok: false, reason: "tenant_idp_required" });
  });

  it("changing the issuer resets the requirement", async () => {
    const second = await startIssuer();
    try {
      const owner = await signIn(t, acme.tenantId, acme.owner);
      const current = TenantIdentityProviderSchema.parse(
        (await owner.get("/api/v1/tenant/identity-provider")).body.identityProvider,
      );
      await owner
        .put("/api/v1/tenant/identity-provider")
        .send({ issuer: second.url, clientId: "acme-app-2", version: current.version })
        .expect(400); // new issuer needs its own secret
      const updated = await owner
        .put("/api/v1/tenant/identity-provider")
        .send({
          issuer: second.url,
          clientId: "acme-app-2",
          clientSecret: "second-secret",
          version: current.version,
        })
        .expect(200);
      expect(updated.body).toMatchObject({ issuer: second.url, enforcement: "optional" });
    } finally {
      await second.close();
    }
  });

  it("removing it unlinks people who moved, so the shared provider works for them again", async () => {
    const owner = await signIn(t, other.tenantId, other.owner);
    // Someone in `other` moves to its provider…
    const email = `traveller@${other.domain}`;
    await provisioning().signIn(
      claims(email, issuer.url, "trav"),
      meta,
      tenantProvider(other.tenantId),
    );
    expect(await t.database.system.identity.findFirstOrThrow({ where: { email } })).toMatchObject({
      oidcIssuer: issuer.url,
    });

    await owner
      .delete("/api/v1/tenant/identity-provider")
      .send({ reason: "migrating" })
      .expect(204);
    expect(await t.database.system.identity.findFirstOrThrow({ where: { email } })).toMatchObject({
      oidcIssuer: null,
      oidcSubject: null,
    });
    const audit = await owner.get("/api/v1/audit-events?action=tenant.idp_removed").expect(200);
    expect(audit.body.items[0]).toMatchObject({
      metadata: { reason: "migrating", unlinkedIdentities: 1 },
    });

    // …and can now sign in through the shared provider again.
    const back = await provisioning().signIn(
      claims(email, "https://shared.example", "trav2"),
      meta,
    );
    expect(back).toMatchObject({ ok: true, tenantId: other.tenantId });
  });
});
