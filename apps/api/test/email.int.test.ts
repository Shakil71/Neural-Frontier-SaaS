import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EmailService } from "../src/modules/email/email.service.js";
import { buildMessage } from "../src/modules/email/mime.js";
import { sendMail, SmtpError } from "../src/modules/email/smtp.js";
import { type Fixture, PUBLIC_URL, type TestApp, seedTenant, signIn, startApp } from "./helpers.js";
import { type Sink, selfSigned, startSink, textPart } from "./smtp-sink.js";

const tls = selfSigned();
let t: TestApp;
let f: Fixture;
let sink: Sink;

const mail = (to = "ana@example.test") =>
  buildMessage({
    from: { address: "noreply@example.test", name: "Neural Frontier" },
    to,
    subject: "Grüße — test",
    text: "Line one\n.leading dot\nLine three",
    html: "<p>Hello</p>",
  });

let ip = 0;
function pub(path: string) {
  ip++;
  return request(t.http)
    .post(`/api/v1/auth/${path}`)
    .set("Origin", PUBLIC_URL)
    .set("X-Forwarded-For", `203.0.113.${ip % 250}`);
}

/** Runs the worker's job for every queued message (the worker process isn't started in tests). */
async function flush(tenantId: string) {
  const queued = await t.database.system.emailMessage.findMany({
    where: { tenantId, status: "queued" },
  });
  for (const m of queued) await t.app.get(EmailService).sendQueued(tenantId, m.id, 1);
}

function settings(port: number, extra: Record<string, unknown> = {}) {
  return {
    host: "127.0.0.1",
    port,
    security: "none",
    username: "relay-user",
    password: "relay-pass-123",
    fromAddress: `noreply@${f.domain}`,
    fromName: "Acme Admin Center",
    enabled: true,
    ...extra,
  };
}

beforeAll(async () => {
  t = await startApp({ NF_DATA_KEY: randomBytes(32).toString("base64") });
  f = await seedTenant(t, "mail");
  sink = await startSink();
});
afterAll(async () => {
  await sink?.close();
  await t?.close();
});

describe("SMTP client", () => {
  it("delivers over a plain local connection with AUTH PLAIN, dot-stuffing and UTF-8", async () => {
    const reply = await sendMail(
      {
        host: "127.0.0.1",
        port: sink.port,
        security: "none",
        username: "u",
        password: "p",
        clientName: "nf.test",
      },
      { from: "noreply@example.test", to: ["ana@example.test"] },
      mail(),
    );
    expect(reply).toMatch(/^250 /);
    const got = sink.messages.at(-1)!;
    expect(got.auth).toEqual({ user: "u", pass: "p" });
    expect(got.to).toEqual(["ana@example.test"]);
    expect(got.data).toContain("Subject: =?UTF-8?B?");
    expect(textPart(got.data)).toBe("Line one\n.leading dot\nLine three");
  });

  it("treats a 5xx refusal as permanent", async () => {
    const strict = await startSink({ rejectRcpt: true });
    const err = await sendMail(
      { host: "127.0.0.1", port: strict.port, security: "none", clientName: "nf.test" },
      { from: "a@example.test", to: ["nobody@example.test"] },
      mail("nobody@example.test"),
    ).catch((e: unknown) => e);
    await strict.close();
    expect(err).toBeInstanceOf(SmtpError);
    expect((err as SmtpError).permanent).toBe(true);
    expect((err as SmtpError).code).toBe(550);
  });

  it("refuses to send a password unencrypted to a remote server", async () => {
    await expect(
      sendMail(
        {
          host: "mail.example.test",
          port: 25,
          security: "none",
          username: "u",
          password: "p",
          clientName: "x",
        },
        { from: "a@example.test", to: ["b@example.test"] },
        mail(),
      ),
    ).rejects.toThrow(/without encryption/);
  });

  it("says plainly when nothing listens", async () => {
    await expect(
      sendMail(
        { host: "127.0.0.1", port: 1, security: "none", clientName: "x", timeoutMs: 3000 },
        { from: "a@example.test", to: ["b@example.test"] },
        mail(),
      ),
    ).rejects.toThrow(/refused|stopped responding|closed/);
  });

  describe.skipIf(!tls)("TLS", () => {
    it("upgrades with STARTTLS and verifies the certificate", async () => {
      const s = await startSink({ mode: "starttls", tls: tls! });
      await sendMail(
        {
          host: "localhost",
          port: s.port,
          security: "starttls",
          username: "u",
          password: "p",
          clientName: "x",
          ca: tls!.cert,
        },
        { from: "a@example.test", to: ["b@example.test"] },
        mail("b@example.test"),
      );
      expect(s.messages[0]).toMatchObject({ tls: true, auth: { user: "u", pass: "p" } });
      // Without trusting that certificate, the connection is refused.
      await expect(
        sendMail(
          { host: "localhost", port: s.port, security: "starttls", clientName: "x" },
          { from: "a@example.test", to: ["b@example.test"] },
          mail("b@example.test"),
        ),
      ).rejects.toThrow(/not trusted/);
      await s.close();
    });

    it("speaks implicit TLS (port 465 style)", async () => {
      const s = await startSink({ mode: "tls", tls: tls! });
      await sendMail(
        { host: "localhost", port: s.port, security: "tls", clientName: "x", ca: tls!.cert },
        { from: "a@example.test", to: ["b@example.test"] },
        mail("b@example.test"),
      );
      expect(s.messages[0]?.tls).toBe(true);
      await s.close();
    });
  });
});

describe("email settings", () => {
  it("only people who manage the organisation can change them; the password never comes back", async () => {
    const auditor = await signIn(t, f.tenantId, f.auditor);
    await auditor.put("/api/v1/tenant/email").send(settings(sink.port)).expect(403);
    const admin = await signIn(t, f.tenantId, f.admin);
    const saved = await admin.put("/api/v1/tenant/email").send(settings(sink.port)).expect(200);
    expect(saved.body).toMatchObject({ host: "127.0.0.1", passwordHint: "••••-123", version: 0 });
    expect(JSON.stringify(saved.body)).not.toContain("relay-pass-123");
    const read = await auditor.get("/api/v1/tenant/email").expect(200);
    expect(read.body.email.username).toBe("relay-user");
    // Keeping the password: omit it.
    const { password: _omit, ...rest } = settings(sink.port);
    await admin
      .put("/api/v1/tenant/email")
      .send({ ...rest, version: 0 })
      .expect(200);
    await admin
      .put("/api/v1/tenant/email")
      .send({ ...rest, version: 0 })
      .expect(409);
  });

  it("refuses targets that would turn the API into a port scanner", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const current = (await admin.get("/api/v1/tenant/email")).body.email.version as number;
    const bad = [
      { host: "intranet.example.test", port: 8080, security: "starttls" },
      { host: "mail.example.test", port: 25, security: "none" },
      { host: "169.254.169.254", port: 25, security: "starttls" },
    ];
    for (const b of bad) {
      await admin
        .put("/api/v1/tenant/email")
        .send(settings(sink.port, { ...b, version: current }))
        .expect(400);
    }
  });

  it("sends a test to the person asking and records the result", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const before = sink.messages.length;
    const res = await admin.post("/api/v1/tenant/email/test").expect(200);
    expect(res.body).toMatchObject({ ok: true, to: `admin@${f.domain}` });
    expect(sink.messages.length).toBe(before + 1);
    expect(sink.messages.at(-1)!.auth).toEqual({ user: "relay-user", pass: "relay-pass-123" });
    const read = await admin.get("/api/v1/tenant/email").expect(200);
    expect(read.body.email.lastTest.ok).toBe(true);
  });
});

describe("forgot password", () => {
  it("emails a working reset link, says the same thing for unknown accounts, and rate-limits", async () => {
    const discovered = await pub("discover")
      .send({ email: `member@${f.domain}` })
      .expect(200);
    expect(discovered.body).toMatchObject({ password: true, passwordReset: true });

    const before = sink.messages.length;
    const known = await pub("password-reset")
      .send({ email: `member@${f.domain}` })
      .expect(202);
    const unknown = await pub("password-reset")
      .send({ email: `ghost@${f.domain}` })
      .expect(202);
    expect(known.body).toEqual(unknown.body);
    await pub("password-reset")
      .send({ email: `member@${f.domain}` })
      .expect(202); // rate-limited
    await flush(f.tenantId);
    expect(sink.messages.length).toBe(before + 1);

    const got = sink.messages.at(-1)!;
    expect(got.to).toEqual([`member@${f.domain}`]);
    const body = textPart(got.data);
    const token = /#(nfl_[A-Za-z0-9_-]{43})/.exec(body)?.[1];
    expect(token).toBeTruthy();
    await pub("sign-in-links/redeem")
      .send({ token, password: "copper-lantern-tide-58" })
      .expect(200);
    await pub("password")
      .send({ email: `member@${f.domain}`, password: "copper-lantern-tide-58" })
      .expect(200);

    // Once sent, the stored body (which held the link) is erased.
    const row = await t.database.system.emailMessage.findFirst({
      where: { tenantId: f.tenantId, kind: "password_reset" },
      orderBy: { createdAt: "desc" },
    });
    expect(row).toMatchObject({ status: "sent", bodySealed: null });
  });

  it("an administrator can email a sign-in link directly", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const someone = await t.database.system.identity.create({
      data: { tenantId: f.tenantId, email: `newbie@${f.domain}`, displayName: "New Bie" },
    });
    const res = await admin
      .post(`/api/v1/identities/${someone.id}/sign-in/link`)
      .send({ reason: "Welcome aboard", sendEmail: true })
      .expect(200);
    expect(res.body.emailedTo).toBe(`newbie@${f.domain}`);
    await flush(f.tenantId);
    expect(textPart(sink.messages.at(-1)!.data)).toContain("invited you to sign in");
    const list = await admin.get("/api/v1/tenant/email/deliveries").expect(200);
    expect(list.body.deliveries[0]).toMatchObject({
      kind: "sign_in_link",
      status: "sent",
      to: `newbie@${f.domain}`,
    });
  });

  it("failed deliveries are recorded and their bodies erased", async () => {
    const svc = t.app.get(EmailService);
    const id = await svc.queue(f.tenantId, `member@${f.domain}`, "test", {
      subject: "x",
      text: "x",
      html: "x",
    });
    await svc.markFailed(f.tenantId, id!, "550 No such user");
    const row = await t.database.system.emailMessage.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({
      status: "failed",
      bodySealed: null,
      lastError: "550 No such user",
    });
  });
});

describe("where you're signed in", () => {
  it("lists your sessions and ends the others", async () => {
    const one = await signIn(t, f.tenantId, f.member);
    const two = await signIn(t, f.tenantId, f.member);
    const list = await one.get("/api/v1/me/sessions").expect(200);
    const current = list.body.sessions.find((s: { current: boolean }) => s.current);
    expect(current).toBeTruthy();
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(2);
    await one.delete(`/api/v1/me/sessions/${current.id}`).expect(400);
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    await one.delete(`/api/v1/me/sessions/${other.id}`).expect(200);
    const res = await one.post("/api/v1/me/sessions/revoke-others").expect(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(0);
    await one.get("/api/v1/me/sessions").expect(200);
    await two.get("/api/v1/me/sessions").expect(401);
  });

  it("you can't end someone else's session through your own list", async () => {
    const mine = await signIn(t, f.tenantId, f.auditor);
    const theirs = await signIn(t, f.tenantId, f.admin);
    const theirList = await theirs.get("/api/v1/me/sessions").expect(200);
    await mine.delete(`/api/v1/me/sessions/${theirList.body.sessions[0].id}`).expect(404);
  });

  it("administrators can sign someone out everywhere, within containment", async () => {
    const admin = await signIn(t, f.tenantId, f.admin);
    const victim = await signIn(t, f.tenantId, f.member);
    const methods = await admin.get(`/api/v1/identities/${f.member}/sign-in`).expect(200);
    expect(methods.body.activeSessions).toBeGreaterThanOrEqual(1);
    expect(methods.body.emailAvailable).toBe(true);
    await admin
      .post(`/api/v1/identities/${f.member}/sign-in/sessions/revoke`)
      .send({ reason: "Lost laptop" })
      .expect(200);
    await victim.get("/api/v1/me/sessions").expect(401);
    await admin
      .post(`/api/v1/identities/${f.owner}/sign-in/sessions/revoke`)
      .send({ reason: "nope" })
      .expect(403);
  });
});
