import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IssuedEnrollmentKeySchema, ServerDetailSchema, ServerSummarySchema } from "@nf/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { type Fixture, seedTenant, signIn, startApp, type TestApp } from "./helpers.js";

let t: TestApp;
let acme: Fixture;
let other: Fixture;
const dist = mkdtempSync(join(tmpdir(), "nf-agent-dist-"));
const fakeBinary = Buffer.from("#!/bin/sh\necho fake agent\n");

beforeAll(async () => {
  writeFileSync(join(dist, "nf-agent-linux-amd64"), fakeBinary);
  t = await startApp({ NF_AGENT_DIST_DIR: dist, NF_AGENT_INTERVAL_SECONDS: "300" });
  acme = await seedTenant(t, "srv");
  other = await seedTenant(t, "srv-other");
});
afterAll(() => t?.close());

const machine = (n: number) => n.toString(16).padStart(32, "0");

function inventory(machineId: string, overrides: Record<string, unknown> = {}) {
  return {
    agentVersion: "test-1",
    collectedAt: new Date().toISOString(),
    hostname: "web-01.acme.example",
    machineId,
    os: {
      id: "ol",
      name: "Oracle Linux Server",
      version: "9.8",
      prettyName: "Oracle Linux Server 9.8",
      kernel: "5.15.0-300.el9uek.x86_64",
      arch: "amd64",
    },
    cpu: { model: "Intel(R) Xeon(R) Gold 6338", cores: 8 },
    memory: { totalBytes: 16 * 2 ** 30, availableBytes: 9 * 2 ** 30 },
    uptimeSeconds: 86_400,
    loadAverage: [0.4, 0.3, 0.2],
    disks: [
      { mount: "/", device: "/dev/mapper/ol-root", fsType: "xfs", sizeBytes: 100, usedBytes: 40 },
      { mount: "/data", device: "/dev/sda6", fsType: "xfs", sizeBytes: 100, usedBytes: 85 },
    ],
    interfaces: [{ name: "ens192", mac: "00:50:56:aa:bb:cc", addresses: ["192.168.197.100/24"] }],
    services: [{ name: "nginx.service", description: "The nginx HTTP and reverse proxy server" }],
    packages: [
      { name: "bash", version: "5.1.8-9.el9.x86_64" },
      { name: "nginx", version: "1.26.3-1.el9.x86_64" },
    ],
    packageManager: "rpm",
    packagesHash: "a".repeat(64),
    packageCount: 2,
    ...overrides,
  };
}

async function newKey(fixture: Fixture, body: Record<string, unknown> = { name: "Rollout" }) {
  const admin = await signIn(t, fixture.tenantId, fixture.admin);
  const res = await admin.post("/api/v1/agent-enrollment-keys").send(body).expect(201);
  return IssuedEnrollmentKeySchema.parse(res.body);
}

const enroll = (key: string, machineId: string, hostname = "web-01") =>
  request(t.http).post("/api/agent/v1/enroll").send({ enrollmentKey: key, machineId, hostname });
const report = (token: string, body: object) =>
  request(t.http)
    .post("/api/agent/v1/inventory")
    .set("Authorization", `Bearer ${token}`)
    .send(body);

describe("enrollment keys", () => {
  it("are managed by administrators; auditors can only view", async () => {
    const auditor = await signIn(t, acme.tenantId, acme.auditor);
    await auditor.post("/api/v1/agent-enrollment-keys").send({ name: "x" }).expect(403);
    await auditor.get("/api/v1/agent-enrollment-keys").expect(200);
    const issued = await newKey(acme);
    expect(issued.key).toMatch(/^nfe_/);
    expect(issued.installCommand).toContain(`--key ${issued.key}`);
    const list = await auditor.get("/api/v1/agent-enrollment-keys").expect(200);
    expect(JSON.stringify(list.body)).not.toContain(issued.key);
    expect(list.body.agentAvailable).toBe(true);
  });

  it("refuse unknown, revoked and used-up keys", async () => {
    await enroll("nfe_" + "x".repeat(32), machine(1)).expect(401);
    const once = await newKey(acme, { name: "single", maxUses: 1 });
    await enroll(once.key, machine(2)).expect(200);
    await enroll(once.key, machine(3)).expect(401);
    const revoked = await newKey(acme, { name: "to revoke" });
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin.delete(`/api/v1/agent-enrollment-keys/${revoked.enrollmentKey.id}`).expect(200);
    await enroll(revoked.key, machine(4)).expect(401);
  });
});

describe("agent lifecycle", () => {
  let token: string;
  let serverId: string;

  it("enrolls, reports and shows up as online with its inventory", async () => {
    const issued = await newKey(acme);
    const res = await enroll(issued.key, machine(10)).expect(200);
    token = res.body.agentToken;
    serverId = res.body.serverId;
    expect(token).toMatch(/^nfa_/);
    expect(res.body.intervalSeconds).toBe(300);

    await report(token, inventory(machine(10))).expect(204);

    const admin = await signIn(t, acme.tenantId, acme.admin);
    const list = z
      .array(ServerSummarySchema)
      .parse((await admin.get("/api/v1/servers").expect(200)).body);
    const s = list.find((x) => x.id === serverId)!;
    expect(s).toMatchObject({
      hostname: "web-01.acme.example",
      status: "online",
      packageCount: 2,
      serviceCount: 1,
      diskPeak: 0.85,
      ipAddresses: ["192.168.197.100"],
    });
    const detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(detail.packages.map((p) => p.name)).toEqual(["bash", "nginx"]);
    const audit = await admin.get("/api/v1/audit-events?action=server.enrolled").expect(200);
    expect(audit.body.items[0]).toMatchObject({ target: { id: serverId } });
  });

  it("accepts a report without packages when the list is unchanged, and asks for it otherwise", async () => {
    const { packages: _drop, ...noPackages } = inventory(machine(10));
    await report(token, noPackages).expect(204);
    const changed = { ...noPackages, packagesHash: "b".repeat(64) };
    const res = await report(token, changed).expect(409);
    expect(res.body.error.message).toBe("packages_required");
    const admin = await signIn(t, acme.tenantId, acme.admin);
    const detail = (await admin.get(`/api/v1/servers/${serverId}`)).body;
    expect(detail.packages).toHaveLength(2); // the stored list is kept
  });

  it("refuses malformed reports and a token copied to another machine", async () => {
    await report(token, { ...inventory(machine(10)), machineId: "not-a-machine-id" }).expect(400);
    await report(token, inventory(machine(99))).expect(403);
    await report("nfa_" + "A".repeat(43), inventory(machine(10))).expect(401);
    await request(t.http)
      .post("/api/agent/v1/inventory")
      .send(inventory(machine(10)))
      .expect(401);
  });

  it("re-enrolling the same machine rotates its token (old one stops working)", async () => {
    const issued = await newKey(acme);
    const res = await enroll(issued.key, machine(10), "web-01-renamed").expect(200);
    expect(res.body.serverId).toBe(serverId);
    await report(token, inventory(machine(10))).expect(401);
    token = res.body.agentToken;
    await report(token, inventory(machine(10))).expect(204);
  });

  it("retiring cuts the agent off and is audited", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin
      .delete(`/api/v1/servers/${serverId}`)
      .send({ reason: "decommissioned" })
      .expect(204);
    await report(token, inventory(machine(10))).expect(401);
    const s = (await admin.get(`/api/v1/servers/${serverId}`)).body;
    expect(s.status).toBe("retired");
  });

  it("servers are invisible to other tenants", async () => {
    const stranger = await signIn(t, other.tenantId, other.owner);
    await stranger.get(`/api/v1/servers/${serverId}`).expect(404);
    expect((await stranger.get("/api/v1/servers").expect(200)).body).toEqual([]);
  });
});

describe("installer", () => {
  it("serves an install script that verifies the binary checksum", async () => {
    const res = await request(t.http).get("/api/agent/v1/install.sh").expect(200);
    const sum = createHash("sha256").update(fakeBinary).digest("hex");
    expect(res.text).toContain(`SUM_amd64='${sum}'`);
    expect(res.text).toContain("checksum mismatch: refusing to install");
    expect(res.text).toContain("NoNewPrivileges=yes");
  });

  it("serves only known builds", async () => {
    const bin = await request(t.http)
      .get("/api/agent/v1/download/amd64")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(bin.body as Buffer, fakeBinary)).toBe(0);
    await request(t.http).get("/api/agent/v1/download/arm64").expect(404);
    await request(t.http).get("/api/agent/v1/download/..%2f..%2fetc%2fpasswd").expect(404);
  });
});
