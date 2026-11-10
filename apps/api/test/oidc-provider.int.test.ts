import { createHash, randomBytes } from "node:crypto";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, PUBLIC_URL, type TestApp, seedTenant, signIn, startApp } from "./helpers.js";

const ISSUER = `${PUBLIC_URL}/api/oidc`;
const REDIRECT = "https://app.example/callback";
const BYE = "https://app.example/signed-out";

let t: TestApp;
let f: Fixture;
let other: Fixture;
let web: { clientId: string; secret: string; id: string };

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

function cookieFor(token: string) {
  return `${t.config.cookie.sessionName}=${token}`;
}

/** Runs the authorization request as a signed-in browser would; returns the redirect target. */
async function authorize(
  sessionToken: string | null,
  params: Record<string, string>,
): Promise<URL> {
  const req = request(t.http).get(`/api/oidc/authorize?${new URLSearchParams(params)}`);
  if (sessionToken) req.set("Cookie", cookieFor(sessionToken));
  const res = await req.expect(303);
  return new URL(res.headers.location as string);
}

function authParams(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: "openid email profile roles",
    state: "st-123",
    nonce: "n-456",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extra,
  };
}

function exchange(form: Record<string, string>, basic?: string) {
  const req = request(t.http).post("/api/oidc/token").type("form").send(form);
  if (basic) req.set("Authorization", `Basic ${basic}`);
  return req;
}

async function jwks() {
  const res = await request(t.http).get("/api/oidc/jwks").expect(200);
  return createLocalJWKSet(res.body);
}

beforeAll(async () => {
  t = await startApp({ NF_DATA_KEY: randomBytes(32).toString("base64") });
  f = await seedTenant(t, "oidcp");
  other = await seedTenant(t, "oidcx");
  const admin = await signIn(t, f.tenantId, f.admin);
  const created = await admin
    .post("/api/v1/applications")
    .send({
      type: "web",
      name: "Expense portal",
      redirectUris: [REDIRECT],
      postLogoutRedirectUris: [BYE],
    })
    .expect(201);
  web = {
    clientId: created.body.application.clientId,
    secret: created.body.clientSecret,
    id: created.body.application.id,
  };
});
afterAll(() => t?.close());

describe("registration", () => {
  it("administrators register applications; the secret is shown once; auditors only read", async () => {
    expect(web.clientId).toMatch(/^nfapp_/);
    expect(web.secret).toMatch(/^nfcs_/);
    const auditor = await signIn(t, f.tenantId, f.auditor);
    const list = await auditor.get("/api/v1/applications").expect(200);
    expect(list.body.issuer).toBe(ISSUER);
    expect(JSON.stringify(list.body)).not.toContain(web.secret);
    await auditor
      .post("/api/v1/applications")
      .send({ type: "spa", name: "x", redirectUris: [REDIRECT] })
      .expect(403);
    const member = await signIn(t, f.tenantId, f.member);
    await member.get("/api/v1/applications").expect(403);
  });

  it("refuses unsafe redirect URIs", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    for (const uri of [
      "http://app.example/cb",
      "https://app.example/cb#frag",
      "javascript:alert(1)",
    ]) {
      await admin
        .post("/api/v1/applications")
        .send({ type: "web", name: "Bad", redirectUris: [uri] })
        .expect(400);
    }
    await admin
      .post("/api/v1/applications")
      .send({
        type: "native",
        name: "Mobile",
        redirectUris: ["com.example.app:/callback", "http://127.0.0.1:8765/cb"],
      })
      .expect(201);
  });
});

describe("discovery", () => {
  it("publishes the provider metadata and its keys", async () => {
    const res = await request(t.http).get("/api/oidc/.well-known/openid-configuration").expect(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      code_challenge_methods_supported: ["S256"],
      id_token_signing_alg_values_supported: ["ES256"],
    });
    const keys = await request(t.http).get("/api/oidc/jwks").expect(200);
    expect(keys.body.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(keys.body.keys[0].d).toBeUndefined(); // never the private part
  });
});

describe("sign-in flow", () => {
  it("sends people who aren't signed in to the sign-in page, and back afterwards", async () => {
    const { challenge } = pkce();
    const to = await authorize(
      null,
      authParams(web.clientId, challenge, { login_hint: `member@${f.domain}` }),
    );
    expect(to.origin + to.pathname).toBe(`${PUBLIC_URL}/sign-in`);
    expect(to.searchParams.get("returnTo")).toMatch(/^\/api\/oidc\/authorize\?/);
    expect(to.searchParams.get("email")).toBe(`member@${f.domain}`);
    const silent = await authorize(null, authParams(web.clientId, challenge, { prompt: "none" }));
    expect(silent.searchParams.get("error")).toBe("login_required");
  });

  it("issues a code, exchanges it once for verifiable tokens, and serves userinfo", async () => {
    const session = await signIn(t, f.tenantId, f.member);
    const { verifier, challenge } = pkce();
    const back = await authorize(session.token, authParams(web.clientId, challenge));
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("st-123");
    expect(back.searchParams.get("iss")).toBe(ISSUER);
    const code = back.searchParams.get("code")!;

    const form = {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    };
    await exchange({ ...form, client_id: web.clientId, client_secret: "wrong" }).expect(401);
    await exchange({
      ...form,
      code_verifier: pkce().verifier,
      client_id: web.clientId,
      client_secret: web.secret,
    }).expect(400);

    const basic = Buffer.from(`${web.clientId}:${web.secret}`).toString("base64");
    const res = await exchange(form, basic).expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({
      token_type: "Bearer",
      expires_in: 900,
      scope: "openid email profile roles",
    });

    const { payload, protectedHeader } = await jwtVerify(res.body.id_token, await jwks(), {
      issuer: ISSUER,
      audience: web.clientId,
    });
    expect(protectedHeader.alg).toBe("ES256");
    expect(payload).toMatchObject({
      sub: f.member,
      nonce: "n-456",
      email: `member@${f.domain}`,
      email_verified: true,
      roles: ["member"],
      tid: f.tenantId,
      azp: web.clientId,
    });
    expect(typeof payload.auth_time).toBe("number");

    // A code works once.
    const replay = await exchange(form, basic).expect(400);
    expect(replay.body.error).toBe("invalid_grant");

    const info = await request(t.http)
      .get("/api/oidc/userinfo")
      .set("Authorization", `Bearer ${res.body.access_token}`)
      .expect(200);
    expect(info.body).toMatchObject({
      sub: f.member,
      email: `member@${f.domain}`,
      name: expect.any(String),
    });
    // An ID token is not an access token.
    await request(t.http)
      .get("/api/oidc/userinfo")
      .set("Authorization", `Bearer ${res.body.id_token}`)
      .expect(401);
  });

  it("refuses unknown clients and unregistered redirect URIs without redirecting there", async () => {
    const session = await signIn(t, f.tenantId, f.member);
    const { challenge } = pkce();
    const unknown = await authorize(
      session.token,
      authParams("nfapp_AAAAAAAAAAAAAAAAAAAAAA", challenge),
    );
    expect(unknown.pathname).toBe("/sign-in/app-error");
    expect(unknown.searchParams.get("reason")).toBe("unknown_app");
    const evil = await authorize(
      session.token,
      authParams(web.clientId, challenge, { redirect_uri: "https://evil.example/cb" }),
    );
    expect(evil.origin).toBe(PUBLIC_URL);
    expect(evil.searchParams.get("reason")).toBe("bad_redirect");
  });

  it("requires PKCE (S256) and the openid scope", async () => {
    const session = await signIn(t, f.tenantId, f.member);
    const noPkce = await authorize(
      session.token,
      authParams(web.clientId, "x", { code_challenge_method: "plain" }),
    );
    expect(noPkce.searchParams.get("error")).toBe("invalid_request");
    const { challenge } = pkce();
    const noOpenid = await authorize(
      session.token,
      authParams(web.clientId, challenge, { scope: "email" }),
    );
    expect(noOpenid.searchParams.get("error")).toBe("invalid_scope");
  });

  it("keeps applications to their own organisation", async () => {
    const outsider = await signIn(t, other.tenantId, other.owner);
    const { challenge } = pkce();
    const to = await authorize(outsider.token, authParams(web.clientId, challenge));
    expect(to.searchParams.get("reason")).toBe("other_organisation");
  });

  it("can be limited to people with chosen roles", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const restricted = await admin
      .post("/api/v1/applications")
      .send({
        type: "spa",
        name: "Admin tools",
        redirectUris: [REDIRECT],
        allowedRoleIds: [f.roles.administrator],
      })
      .expect(201);
    expect(restricted.body.clientSecret).toBeNull();
    const clientId = restricted.body.application.clientId as string;
    const member = await signIn(t, f.tenantId, f.member);
    const { verifier, challenge } = pkce();
    const denied = await authorize(member.token, authParams(clientId, challenge));
    expect(denied.searchParams.get("error")).toBe("access_denied");

    // A public client: no secret, PKCE only.
    const ok = await authorize(admin.token, authParams(clientId, challenge));
    const form = {
      grant_type: "authorization_code",
      code: ok.searchParams.get("code")!,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      client_id: clientId,
    };
    await exchange({ ...form, client_secret: "anything" }).expect(401);
    const tokens = await exchange(form).expect(200);
    expect(decodeJwt(tokens.body.id_token).roles).toEqual(["administrator"]);
  });

  it("disabled applications and suspended people are refused", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const session = await signIn(t, f.tenantId, f.auditor);
    const { verifier, challenge } = pkce();
    const back = await authorize(session.token, authParams(web.clientId, challenge));
    const tokens = await exchange(
      {
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      },
      Buffer.from(`${web.clientId}:${web.secret}`).toString("base64"),
    ).expect(200);
    await t.database.system.identity.update({
      where: { id: f.auditor },
      data: { status: "suspended" },
    });
    await request(t.http)
      .get("/api/oidc/userinfo")
      .set("Authorization", `Bearer ${tokens.body.access_token}`)
      .expect(401);
    await t.database.system.identity.update({
      where: { id: f.auditor },
      data: { status: "active" },
    });

    const list = await admin.get("/api/v1/applications").expect(200);
    const app = list.body.applications.find((a: { id: string }) => a.id === web.id);
    await admin
      .put(`/api/v1/applications/${web.id}`)
      .send({ ...app, enabled: false, version: app.version })
      .expect(200);
    const fresh = await signIn(t, f.tenantId, f.member);
    const off = await authorize(fresh.token, authParams(web.clientId, pkce().challenge));
    expect(off.searchParams.get("reason")).toBe("app_disabled");
    const again = (await admin.get("/api/v1/applications").expect(200)).body.applications.find(
      (a: { id: string }) => a.id === web.id,
    );
    await admin
      .put(`/api/v1/applications/${web.id}`)
      .send({ ...again, enabled: true, version: again.version })
      .expect(200);
  });
});

describe("sign-out and secrets", () => {
  it("ends the session only with a matching id_token_hint, and returns to a registered address", async () => {
    const session = await signIn(t, f.tenantId, f.member);
    const { verifier, challenge } = pkce();
    const back = await authorize(session.token, authParams(web.clientId, challenge));
    const basic = Buffer.from(`${web.clientId}:${web.secret}`).toString("base64");
    const tokens = await exchange(
      {
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      },
      basic,
    ).expect(200);

    // No hint: nothing ends, and an unregistered address is ignored.
    const noHint = await request(t.http)
      .get(
        `/api/oidc/logout?post_logout_redirect_uri=${encodeURIComponent("https://evil.example/")}`,
      )
      .set("Cookie", cookieFor(session.token))
      .expect(303);
    expect(noHint.headers.location).toBe(`${PUBLIC_URL}/sign-in?signedOut=1`);
    await session.get("/api/v1/auth/session").expect(200);

    const out = await request(t.http)
      .get(
        `/api/oidc/logout?${new URLSearchParams({ id_token_hint: tokens.body.id_token, post_logout_redirect_uri: BYE, state: "bye-1" })}`,
      )
      .set("Cookie", cookieFor(session.token))
      .expect(303);
    expect(out.headers.location).toBe(`${BYE}?state=bye-1`);
    await session.get("/api/v1/auth/session").expect(401);
  });

  it("replacing the secret invalidates the old one", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const rotated = await admin.post(`/api/v1/applications/${web.id}/secret`).expect(200);
    expect(rotated.body.clientSecret).not.toBe(web.secret);
    const res = await exchange({
      grant_type: "authorization_code",
      code: "x".repeat(43),
      redirect_uri: REDIRECT,
      code_verifier: pkce().verifier,
      client_id: web.clientId,
      client_secret: web.secret,
    }).expect(401);
    expect(res.body.error).toBe("invalid_client");
    web.secret = rotated.body.clientSecret;
    const audit = await admin
      .get("/api/v1/audit-events?action=application.secret_rotated")
      .expect(200);
    expect(audit.body.items).toHaveLength(1);
  });
});
