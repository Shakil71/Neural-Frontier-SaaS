import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, currentStep, hotp } from "../src/modules/local-auth/totp.js";
import { type Fixture, PUBLIC_URL, type TestApp, seedTenant, signIn, startApp } from "./helpers.js";

const GOOD = "violet-harbour-lantern-42";
const NEWER = "quiet-meadow-compass-77";

let t: TestApp;
let f: Fixture;

/** Cookie header from a response's Set-Cookie (name=value pairs only). */
function cookiesOf(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => c.split(";")[0]).join("; ");
}

let ip = 0;
/** Public sign-in call. Each from its own client address, so the per-IP rate limit (10/min) does not trip. */
function pub(path: string) {
  ip++;
  return request(t.http)
    .post(`/api/v1/auth/${path}`)
    .set("Origin", PUBLIC_URL)
    .set("X-Forwarded-For", `198.51.100.${ip % 250}`);
}

/** A client for a session cookie obtained through the real sign-in flow. */
async function clientFor(cookie: string) {
  const session = await request(t.http)
    .get("/api/v1/auth/session")
    .set("Cookie", cookie)
    .expect(200);
  const csrf = session.body.csrfToken as string;
  const write = (m: "post" | "put") => (url: string) =>
    request(t.http)
      [m](url)
      .set("Cookie", cookie)
      .set("x-csrf-token", csrf)
      .set("Origin", PUBLIC_URL);
  return {
    session: session.body,
    get: (url: string) => request(t.http).get(url).set("Cookie", cookie),
    post: write("post"),
    put: write("put"),
  };
}

const totpNow = (secret: string, offset = 0) => hotp(base32Decode(secret), currentStep() + offset);

async function issueLink(admin: Awaited<ReturnType<typeof signIn>>, identityId: string) {
  const res = await admin
    .post(`/api/v1/identities/${identityId}/sign-in/link`)
    .send({ reason: "Onboarding to built-in sign-in" })
    .expect(200);
  return { ...res.body, token: (res.body.url as string).split("#")[1]! };
}

async function setPassword(
  admin: Awaited<ReturnType<typeof signIn>>,
  identityId: string,
  pw = GOOD,
) {
  const link = await issueLink(admin, identityId);
  await pub("sign-in-links/redeem").send({ token: link.token, password: pw }).expect(200);
}

async function person(local: string, role: keyof Fixture["roles"] = "member") {
  const identity = await t.database.system.identity.create({
    data: { tenantId: f.tenantId, email: `${local}@${f.domain}`, displayName: `Test ${local}` },
  });
  await t.database.system.roleAssignment.create({
    data: { tenantId: f.tenantId, identityId: identity.id, roleId: f.roles[role], reason: "test" },
  });
  return identity;
}

beforeAll(async () => {
  t = await startApp({ NF_DATA_KEY: randomBytes(32).toString("base64") });
  f = await seedTenant(t, "local");
});
afterAll(() => t?.close());

describe("discovery", () => {
  it("offers password sign-in by domain, never revealing whether an account exists", async () => {
    const known = await pub("discover")
      .send({ email: `nobody@${f.domain}` })
      .expect(200);
    expect(known.body).toEqual({ password: true, sso: false, passwordReset: false });
    const unknown = await pub("discover").send({ email: "x@unregistered.example" }).expect(200);
    expect(unknown.body).toEqual({ password: false, sso: false, passwordReset: false });
  });

  it("refuses cross-site and non-JSON requests (login CSRF)", async () => {
    await request(t.http)
      .post("/api/v1/auth/password")
      .set("Origin", "https://evil.example")
      .send({ email: `admin@${f.domain}`, password: "x" })
      .expect(403);
    await request(t.http)
      .post("/api/v1/auth/password")
      .type("form")
      .send({ email: `admin@${f.domain}`, password: "x" })
      .expect(400);
  });
});

describe("set-up links", () => {
  it("lets a person set their first password exactly once", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const link = await issueLink(admin, f.member);
    expect(link.purpose).toBe("setup");
    expect(link.url).toMatch(new RegExp(`^${PUBLIC_URL}/sign-in/setup#nfl_`));

    const info = await pub("sign-in-links/inspect").send({ token: link.token }).expect(200);
    expect(info.body).toMatchObject({
      purpose: "setup",
      email: `member@${f.domain}`,
      minPasswordLength: 12,
    });

    const weak = await pub("sign-in-links/redeem")
      .send({ token: link.token, password: "password123" })
      .expect(422);
    expect(weak.body.error.details.map((d: { message: string }) => d.message)).toContain(
      "Avoid commonly used passwords",
    );
    await pub("sign-in-links/redeem").send({ token: link.token, password: GOOD }).expect(200);
    await pub("sign-in-links/redeem").send({ token: link.token, password: GOOD }).expect(404);

    const methods = await admin.get(`/api/v1/identities/${f.member}/sign-in`).expect(200);
    expect(methods.body).toMatchObject({
      password: { set: true },
      pendingLink: null,
      manageable: true,
    });
    const audit = await t.database.system.auditEvent.findMany({
      where: { tenantId: f.tenantId, targetId: f.member, action: "auth.sign_in_link_created" },
    });
    expect(audit).toHaveLength(1);
  });

  it("issuing a new link voids the previous one", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const someone = await person("relink");
    const first = await issueLink(admin, someone.id);
    await issueLink(admin, someone.id);
    await pub("sign-in-links/inspect").send({ token: first.token }).expect(404);
  });

  it("contains administrators: no changing the sign-in of someone with more access, or your own", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const ownerTry = await admin
      .post(`/api/v1/identities/${f.owner}/sign-in/link`)
      .send({ reason: "take over the owner" })
      .expect(403);
    expect(ownerTry.body.error.message).toMatch(/access you don't have/);
    await admin
      .post(`/api/v1/identities/${f.admin}/sign-in/link`)
      .send({ reason: "self" })
      .expect(403);
    const auditor = await signIn(t, f.tenantId, f.auditor);
    await auditor
      .post(`/api/v1/identities/${f.member}/sign-in/link`)
      .send({ reason: "nope" })
      .expect(403);
    const view = await admin.get(`/api/v1/identities/${f.owner}/sign-in`).expect(200);
    expect(view.body.manageable).toBe(false);
  });
});

describe("password sign-in", () => {
  it("signs in with the right password and opens a working, local session", async () => {
    const res = await pub("password")
      .send({ email: `member@${f.domain}`, password: GOOD, returnTo: "/identities" })
      .expect(200);
    expect(res.body).toEqual({ status: "signed_in", redirectTo: "/identities" });
    const me = await clientFor(cookiesOf(res));
    expect(me.session.user.email).toBe(`member@${f.domain}`);
    const sec = await me.get("/api/v1/me/security").expect(200);
    expect(sec.body).toMatchObject({ signedInWith: "local", password: { set: true } });
  });

  it("gives the same answer for a wrong password and an unknown account; refuses unsafe redirects", async () => {
    const wrong = await pub("password")
      .send({ email: `member@${f.domain}`, password: "nope-nope-nope" })
      .expect(401);
    const unknown = await pub("password")
      .send({ email: `ghost@${f.domain}`, password: "nope-nope-nope" })
      .expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    const evil = await pub("password")
      .send({ email: `member@${f.domain}`, password: GOOD, returnTo: "//evil.example" })
      .expect(200);
    expect(evil.body.redirectTo).toBe("/");
  });

  it("locks the account after five failures, even for the right password, until an admin unlocks it", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const victim = await person("lockme");
    await setPassword(admin, victim.id);
    for (let i = 0; i < 5; i++) {
      await pub("password")
        .send({ email: victim.email, password: "wrong-wrong-wrong" })
        .expect(401);
    }
    const locked = await pub("password").send({ email: victim.email, password: GOOD }).expect(429);
    expect(locked.body.error.message).toMatch(/Too many attempts/);
    const view = await admin.get(`/api/v1/identities/${victim.id}/sign-in`).expect(200);
    expect(view.body.lockedUntil).not.toBeNull();

    await admin
      .post(`/api/v1/identities/${victim.id}/sign-in/unlock`)
      .send({ reason: "Verified by phone" })
      .expect(200);
    await pub("password").send({ email: victim.email, password: GOOD }).expect(200);
    const events = await t.database.system.auditEvent.findMany({
      where: {
        tenantId: f.tenantId,
        targetId: victim.id,
        action: { in: ["auth.account_locked", "auth.account_unlocked"] },
      },
    });
    expect(events.map((e) => e.action).sort()).toEqual([
      "auth.account_locked",
      "auth.account_unlocked",
    ]);
  });

  it("refuses suspended people even with the right password", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const gone = await person("suspended");
    await setPassword(admin, gone.id);
    await t.database.system.identity.update({
      where: { id: gone.id },
      data: { status: "suspended" },
    });
    await pub("password").send({ email: gone.email, password: GOOD }).expect(403);
  });
});

describe("two-factor", () => {
  it("enrols an authenticator, then demands it; codes cannot be replayed; recovery codes work once", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const ana = await person("ana");
    await setPassword(admin, ana.id);
    const first = await pub("password").send({ email: ana.email, password: GOOD }).expect(200);
    const me = await clientFor(cookiesOf(first));

    const setup = await me.post("/api/v1/me/security/two-factor/setup").expect(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Neural%20Frontier:ana%40/);
    await me.post("/api/v1/me/security/two-factor/enable").send({ code: "000000" }).expect(400);
    const enabled = await me
      .post("/api/v1/me/security/two-factor/enable")
      .send({ code: totpNow(setup.body.secret) })
      .expect(200);
    const codes = enabled.body.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);

    // Password alone is no longer enough.
    const step1 = await pub("password").send({ email: ana.email, password: GOOD }).expect(200);
    expect(step1.body).toEqual({ status: "two_factor_required" });
    const challenge = cookiesOf(step1);
    // Without the challenge cookie there is nothing to complete.
    await pub("two-factor")
      .send({ code: totpNow(setup.body.secret, 1) })
      .expect(401);
    // The code used to enable is spent; the next step's code works once.
    await pub("two-factor")
      .set("Cookie", challenge)
      .send({ code: totpNow(setup.body.secret) })
      .expect(400);
    const done = await pub("two-factor")
      .set("Cookie", challenge)
      .send({ code: totpNow(setup.body.secret, 1) })
      .expect(200);
    expect(done.body.status).toBe("signed_in");
    const again = await pub("password").send({ email: ana.email, password: GOOD }).expect(200);
    await pub("two-factor")
      .set("Cookie", cookiesOf(again))
      .send({ code: totpNow(setup.body.secret, 1) })
      .expect(400);

    // A recovery code works exactly once (any case, with or without the dash).
    const r1 = await pub("password").send({ email: ana.email, password: GOOD }).expect(200);
    await pub("two-factor")
      .set("Cookie", cookiesOf(r1))
      .send({ code: codes[0]!.toUpperCase() })
      .expect(200);
    const r2 = await pub("password").send({ email: ana.email, password: GOOD }).expect(200);
    await pub("two-factor")
      .set("Cookie", cookiesOf(r2))
      .send({ code: codes[0]!.replace("-", "") })
      .expect(400);

    const sec = await me.get("/api/v1/me/security").expect(200);
    expect(sec.body.twoFactor).toMatchObject({ enabled: true, recoveryCodesRemaining: 9 });

    // An administrator can reset it for someone who lost their phone.
    await admin
      .post(`/api/v1/identities/${ana.id}/sign-in/reset-two-factor`)
      .send({ reason: "Lost phone, verified in person" })
      .expect(200);
    const after = await pub("password").send({ email: ana.email, password: GOOD }).expect(200);
    expect(after.body.status).toBe("signed_in");
  });

  it("a forged or tampered challenge cookie is rejected", async () => {
    await pub("two-factor")
      .set("Cookie", "nf_2fa=eyJhbGciOiJkaXIifQ..AAAA.BBBB.CCCC; __Host-nf_2fa=x")
      .send({ code: "123456" })
      .expect(401);
  });
});

describe("tenant sign-in policy", () => {
  it("only the owner can change it, with optimistic concurrency", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const current = await admin.get("/api/v1/tenant/sign-in-policy").expect(200);
    expect(current.body).toMatchObject({
      passwordSignIn: true,
      twoFactor: "optional",
      minPasswordLength: 12,
      version: 0,
    });
    await admin
      .put("/api/v1/tenant/sign-in-policy")
      .send({
        passwordSignIn: true,
        twoFactor: "required",
        minPasswordLength: 14,
        version: 0,
        reason: "harden",
      })
      .expect(403);
    const owner = await signIn(t, f.tenantId, f.owner);
    await owner
      .put("/api/v1/tenant/sign-in-policy")
      .send({
        passwordSignIn: true,
        twoFactor: "required",
        minPasswordLength: 14,
        version: 0,
        reason: "Harden sign-in",
      })
      .expect(200);
    await owner
      .put("/api/v1/tenant/sign-in-policy")
      .send({
        passwordSignIn: true,
        twoFactor: "required",
        minPasswordLength: 14,
        version: 0,
        reason: "stale",
      })
      .expect(409);
  });

  it("required two-factor makes people set it up during sign-in, and keeps it on", async () => {
    // Policy is "required" from the previous test.
    const admin = await signIn(t, f.tenantId, f.admin);
    const ben = await person("ben");
    const link = await issueLink(admin, ben.id);
    await pub("sign-in-links/redeem")
      .send({ token: link.token, password: "short-but-12" })
      .expect(422);
    await pub("sign-in-links/redeem").send({ token: link.token, password: GOOD }).expect(200);

    const step = await pub("password").send({ email: ben.email, password: GOOD }).expect(200);
    expect(step.body.status).toBe("two_factor_setup_required");
    const secret = step.body.setup.secret as string;
    const done = await pub("two-factor")
      .set("Cookie", cookiesOf(step))
      .send({ code: totpNow(secret) })
      .expect(200);
    expect(done.body.recoveryCodes).toHaveLength(10);
    const me = await clientFor(cookiesOf(done));
    await me
      .post("/api/v1/me/security/two-factor/disable")
      .send({ code: totpNow(secret, 1) })
      .expect(403);
  });

  it("turning password sign-in off refuses passwords and stops offering them", async () => {
    const owner = await signIn(t, f.tenantId, f.owner);
    const policy = await owner.get("/api/v1/tenant/sign-in-policy").expect(200);
    await owner
      .put("/api/v1/tenant/sign-in-policy")
      .send({
        passwordSignIn: false,
        twoFactor: "optional",
        minPasswordLength: 12,
        version: policy.body.version,
        reason: "SSO only",
      })
      .expect(200);
    const res = await pub("password")
      .send({ email: `member@${f.domain}`, password: GOOD })
      .expect(403);
    expect(res.body.error.message).toMatch(/single sign-on/);
    const discovered = await pub("discover")
      .send({ email: `member@${f.domain}` })
      .expect(200);
    expect(discovered.body.password).toBe(false);
    const admin = await signIn(t, f.tenantId, f.admin);
    await admin
      .post(`/api/v1/identities/${f.member}/sign-in/link`)
      .send({ reason: "nope" })
      .expect(409);
    const back = await owner.get("/api/v1/tenant/sign-in-policy").expect(200);
    await owner
      .put("/api/v1/tenant/sign-in-policy")
      .send({
        passwordSignIn: true,
        twoFactor: "optional",
        minPasswordLength: 12,
        version: back.body.version,
        reason: "Re-enable",
      })
      .expect(200);
  });
});

describe("my account", () => {
  it("changing the password needs the current one and signs out every other session", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const cy = await person("cy");
    await setPassword(admin, cy.id);
    const a = await clientFor(
      cookiesOf(await pub("password").send({ email: cy.email, password: GOOD }).expect(200)),
    );
    const b = await clientFor(
      cookiesOf(await pub("password").send({ email: cy.email, password: GOOD }).expect(200)),
    );
    await a.put("/api/v1/me/security/password").send({ newPassword: NEWER }).expect(400);
    await a
      .put("/api/v1/me/security/password")
      .send({ currentPassword: "nope", newPassword: NEWER })
      .expect(400);
    await a
      .put("/api/v1/me/security/password")
      .send({ currentPassword: GOOD, newPassword: GOOD })
      .expect(400);
    await a
      .put("/api/v1/me/security/password")
      .send({ currentPassword: GOOD, newPassword: NEWER })
      .expect(200);
    await a.get("/api/v1/me/security").expect(200);
    await b.get("/api/v1/me/security").expect(401);
    await pub("password").send({ email: cy.email, password: GOOD }).expect(401);
    await pub("password").send({ email: cy.email, password: NEWER }).expect(200);
  });

  it("a single sign-on user can add a first password only from a fresh sign-in", async () => {
    const dee = await person("dee");
    const fresh = await signIn(t, f.tenantId, dee.id);
    await fresh.put("/api/v1/me/security/password").send({ newPassword: GOOD }).expect(200);

    const eve = await person("eve");
    const old = await signIn(t, f.tenantId, eve.id);
    await t.database.system.session.updateMany({
      where: { identityId: eve.id },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });
    const res = await old
      .put("/api/v1/me/security/password")
      .send({ newPassword: GOOD })
      .expect(403);
    expect(res.body.error.message).toMatch(/sign in again/);
  });

  it("two-factor cannot be set up before a password exists", async () => {
    const fay = await person("fay");
    const me = await signIn(t, f.tenantId, fay.id);
    await me.post("/api/v1/me/security/two-factor/setup").expect(409);
  });
});

describe("moving off the shared identity server", () => {
  it("tells the sign-in screen whether shared single sign-on exists", async () => {
    const res = await request(t.http).get("/api/v1/auth/options").expect(200);
    expect(res.body).toEqual({ sharedSso: false });
  });

  it("counts who can already sign in without it, owners first", async () => {
    const auditor = await signIn(t, f.tenantId, f.auditor);
    const before = await auditor.get("/api/v1/tenant/sign-in-policy/readiness").expect(200);
    expect(before.body).toMatchObject({
      owners: 1,
      ownersWithPassword: 0,
      sharedSsoConfigured: false,
      ownProvider: false,
    });
    expect(before.body.withPassword).toBeGreaterThan(0);
    expect(before.body.withTwoFactor).toBeGreaterThan(0);
    expect(before.body.people).toBeGreaterThanOrEqual(before.body.withPassword);

    const owner = await signIn(t, f.tenantId, f.owner);
    await owner.put("/api/v1/me/security/password").send({ newPassword: GOOD }).expect(200);
    const after = await auditor.get("/api/v1/tenant/sign-in-policy/readiness").expect(200);
    expect(after.body.ownersWithPassword).toBe(1);
    expect(after.body.withPassword).toBe(before.body.withPassword + 1);
    const member = await signIn(t, f.tenantId, f.member);
    await member.get("/api/v1/tenant/sign-in-policy/readiness").expect(403);
  });
});
