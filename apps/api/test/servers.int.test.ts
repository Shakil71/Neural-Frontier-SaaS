import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  IssuedEnrollmentKeySchema,
  FleetUpdatesSchema,
  ServerDetailSchema,
  ServerSummarySchema,
  TenantFindingsSchema,
} from "@nf/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { type Fixture, seedTenant, signIn, startApp, type TestApp } from "./helpers.js";

let t: TestApp;
let acme: Fixture;
let other: Fixture;
const dist = mkdtempSync(join(tmpdir(), "nf-agent-dist-"));
const fakeBinary = Buffer.from("#!/bin/sh\necho fake agent\n");
const fakeExe = Buffer.from("MZ fake windows agent");

beforeAll(async () => {
  writeFileSync(join(dist, "nf-agent-linux-amd64"), fakeBinary);
  writeFileSync(join(dist, "nf-agent-windows-amd64.exe"), fakeExe);
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
    expect(issued.windowsInstallCommand).toContain("/api/agent/v1/install.ps1");
    expect(issued.windowsInstallCommand).toContain(`-Key ${issued.key}`);
    const list = await auditor.get("/api/v1/agent-enrollment-keys").expect(200);
    expect(JSON.stringify(list.body)).not.toContain(issued.key);
    expect(list.body.agentAvailable).toBe(true);
    expect(list.body.windowsAgentAvailable).toBe(true);
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

describe("network exposure and findings", () => {
  let token: string;
  let serverId: string;
  const exposed = {
    listeners: [
      { proto: "tcp", address: "0.0.0.0", port: 22, user: "root", process: "sshd" },
      { proto: "tcp", address: "::", port: 3306, user: "mysql", process: "" },
      { proto: "tcp", address: "127.0.0.1", port: 6379, user: "redis", process: "" },
    ],
    firewall: {
      kind: "none",
      active: false,
      rulesKnown: false,
      defaultAllow: false,
      zones: [],
      allowed: [],
    },
    ssh: {
      present: true,
      ports: [22],
      permitRootLogin: "prohibit-password",
      passwordAuthentication: "yes",
      kbdInteractiveAuthentication: "no",
      usePam: "yes",
      permitEmptyPasswords: "no",
    },
  };

  it("an agent without exposure reporting shows no findings (not zero)", async () => {
    const issued = await newKey(acme, { name: "exposure" });
    const res = await enroll(issued.key, machine(20), "db-01").expect(200);
    token = res.body.agentToken;
    serverId = res.body.serverId;
    await report(token, inventory(machine(20), { hostname: "db-01" })).expect(204);
    const admin = await signIn(t, acme.tenantId, acme.admin);
    const detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(detail.exposure).toBeNull();
    expect(detail.findings).toBeNull();
  });

  it("analyses listeners, firewall and SSH into findings", async () => {
    await report(token, inventory(machine(20), { hostname: "db-01", ...exposed })).expect(204);
    const admin = await signIn(t, acme.tenantId, acme.admin);
    const detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(detail.exposure!.listeners.map((l) => [l.port, l.scope, l.reach, l.service])).toEqual([
      [22, "all", "open", "SSH"],
      [3306, "all", "open", "MySQL"],
      [6379, "loopback", "local", "Redis"],
    ]);
    // 192.168.197.100 is the only address: reachable from the local network, not the internet.
    expect(detail.exposure!.findings.map((f) => [f.key, f.severity])).toEqual([
      ["firewall.none", "medium"],
      ["port.exposed:tcp:3306", "medium"],
      ["ssh.password_auth", "medium"],
      ["ssh.root_key", "low"],
    ]);
    expect(detail.findings).toEqual({ high: 0, medium: 3, low: 1 });

    const all = TenantFindingsSchema.parse(
      (await admin.get("/api/v1/server-findings").expect(200)).body,
    );
    expect(all.serversReporting).toBe(1);
    expect(all.items.filter((i) => i.serverId === serverId)).toHaveLength(4);
    expect(all.open).toEqual({ high: 0, medium: 3, low: 1 });
  });

  it("administrators accept a finding with a reason (audited); auditors can't", async () => {
    const key = encodeURIComponent("port.exposed:tcp:3306");
    const auditor = await signIn(t, acme.tenantId, acme.auditor);
    await auditor
      .put(`/api/v1/servers/${serverId}/findings/${key}/acceptance`)
      .send({ reason: "replica traffic" })
      .expect(403);
    await auditor.get("/api/v1/server-findings").expect(200);

    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin
      .put(`/api/v1/servers/${serverId}/findings/${key}/acceptance`)
      .send({ reason: "no" })
      .expect(400);
    // Only a finding the server has right now can be accepted.
    await admin
      .put(`/api/v1/servers/${serverId}/findings/port.exposed:tcp:5432/acceptance`)
      .send({ reason: "not a real finding" })
      .expect(404);
    await admin
      .put(`/api/v1/servers/${serverId}/findings/BAD KEY/acceptance`)
      .send({ reason: "bad key" })
      .expect(400);

    const res = await admin
      .put(`/api/v1/servers/${serverId}/findings/${key}/acceptance`)
      .send({ reason: "Replica traffic from the private network" })
      .expect(200);
    expect(res.body.accepted).toMatchObject({ reason: "Replica traffic from the private network" });

    const detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(detail.findings).toEqual({ high: 0, medium: 2, low: 1 });
    const all = TenantFindingsSchema.parse(
      (await admin.get("/api/v1/server-findings").expect(200)).body,
    );
    expect(all.accepted).toBe(1);
    expect(all.items.at(-1)!.key).toBe("port.exposed:tcp:3306"); // accepted ones sort last

    // The acceptance survives new reports.
    await report(token, inventory(machine(20), { hostname: "db-01", ...exposed })).expect(204);
    expect((await admin.get(`/api/v1/servers/${serverId}`)).body.findings.medium).toBe(2);

    const audit = await admin
      .get("/api/v1/audit-events?action=server.finding_accepted")
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      target: { id: serverId },
      metadata: { finding: "port.exposed:tcp:3306", severity: "medium" },
    });

    await admin.delete(`/api/v1/servers/${serverId}/findings/${key}/acceptance`).expect(204);
    await admin.delete(`/api/v1/servers/${serverId}/findings/${key}/acceptance`).expect(404);
    expect((await admin.get(`/api/v1/servers/${serverId}`)).body.findings.medium).toBe(3);
    const reopened = await admin
      .get("/api/v1/audit-events?action=server.finding_reopened")
      .expect(200);
    expect(reopened.body.items).toHaveLength(1);
  });

  it("fixing the server clears the findings", async () => {
    await report(
      token,
      inventory(machine(20), {
        hostname: "db-01",
        ...exposed,
        firewall: {
          kind: "firewalld",
          active: true,
          rulesKnown: true,
          defaultAllow: false,
          zones: ["public"],
          allowed: [{ proto: "tcp", from: 22, to: 22, scope: "any" }],
        },
        ssh: { ...exposed.ssh, permitRootLogin: "no", passwordAuthentication: "no" },
      }),
    ).expect(204);
    const admin = await signIn(t, acme.tenantId, acme.admin);
    const detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(detail.exposure!.findings).toEqual([]);
    expect(detail.exposure!.listeners.find((l) => l.port === 3306)!.reach).toBe("blocked");
  });

  it("findings are invisible to other tenants", async () => {
    const stranger = await signIn(t, other.tenantId, other.owner);
    const all = TenantFindingsSchema.parse(
      (await stranger.get("/api/v1/server-findings").expect(200)).body,
    );
    expect(all).toMatchObject({ items: [], serversTotal: 0 });
    await stranger
      .put(`/api/v1/servers/${serverId}/findings/ssh.root_key/acceptance`)
      .send({ reason: "cross-tenant attempt" })
      .expect(404);
  });
});

describe("patch compliance", () => {
  let token: string;
  let serverId: string;
  const updates = (overrides: Record<string, unknown> = {}) => ({
    status: "ok",
    error: "",
    manager: "rpm",
    checkedAt: new Date().toISOString(),
    metadataAt: new Date(Date.now() - 3_600_000).toISOString(),
    pending: [
      {
        name: "openssl-libs",
        arch: "x86_64",
        version: "1:3.0.7-28.el9_4",
        security: true,
        severity: "Critical",
        advisory: "ELSA-2026-1003",
      },
      {
        name: "tzdata",
        arch: "noarch",
        version: "2024b-2.el9",
        security: false,
        severity: "",
        advisory: "",
      },
    ],
    rebootRequired: true,
    runningKernel: "5.15.0-325.221.6.6.el9uek.x86_64",
    newestKernel: "5.15.0-326.222.4.el9uek.x86_64",
    ...overrides,
  });

  it("reports pending and security updates, a needed reboot, and their findings", async () => {
    const issued = await newKey(acme, { name: "patching" });
    const res = await enroll(issued.key, machine(30), "app-02").expect(200);
    token = res.body.agentToken;
    serverId = res.body.serverId;
    await report(token, inventory(machine(30), { hostname: "app-02", updates: updates() })).expect(
      204,
    );
    const admin = await signIn(t, acme.tenantId, acme.admin);
    const detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(detail.updates).toMatchObject({
      pending: 2,
      security: 1,
      urgent: 1,
      rebootRequired: true,
    });
    expect(detail.patches!.pending[0]!.advisory).toBe("ELSA-2026-1003");
    expect(detail.patchFindings.map((f) => [f.key, f.severity])).toEqual([
      ["updates.security", "high"],
      ["updates.reboot_required", "medium"],
    ]);
    // No exposure data from this agent: only the update findings count.
    expect(detail.exposure).toBeNull();
    expect(detail.findings).toEqual({ high: 1, medium: 1, low: 0 });

    const fleet = FleetUpdatesSchema.parse(
      (await admin.get("/api/v1/server-updates").expect(200)).body,
    );
    expect(fleet.servers.find((s) => s.serverId === serverId)!.updates).toMatchObject({
      security: 1,
    });
    expect(fleet.topPackages[0]).toMatchObject({
      name: "openssl-libs",
      servers: 1,
      severity: "Critical",
    });
    expect(fleet.totals).toMatchObject({ withSecurity: 1, rebootRequired: 1 });

    const all = TenantFindingsSchema.parse(
      (await admin.get("/api/v1/server-findings").expect(200)).body,
    );
    expect(all.items.filter((i) => i.serverId === serverId).map((i) => i.key)).toEqual([
      "updates.security",
      "updates.reboot_required",
    ]);
  });

  it("an update finding can be accepted like any other", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin
      .put(`/api/v1/servers/${serverId}/findings/updates.reboot_required/acceptance`)
      .send({ reason: "Reboot scheduled for Saturday's window" })
      .expect(200);
    expect((await admin.get(`/api/v1/servers/${serverId}`)).body.findings).toEqual({
      high: 1,
      medium: 0,
      low: 0,
    });
  });

  it("an unavailable package manager is shown as such, never as up to date", async () => {
    await report(
      token,
      inventory(machine(30), {
        hostname: "app-02",
        updates: updates({
          status: "unavailable",
          error: "Read-only file system",
          pending: [],
          rebootRequired: null,
        }),
      }),
    ).expect(204);
    const admin = await signIn(t, acme.tenantId, acme.admin);
    const detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(detail.updates).toMatchObject({ status: "unavailable" });
    expect(detail.patchFindings).toEqual([]);
    const fleet = FleetUpdatesSchema.parse(
      (await admin.get("/api/v1/server-updates").expect(200)).body,
    );
    expect(fleet.totals.upToDate).toBe(0);
  });

  it("refuses oversized or malformed update reports", async () => {
    await report(token, inventory(machine(30), { updates: updates({ status: "maybe" }) })).expect(
      400,
    );
    await report(
      token,
      inventory(machine(30), {
        updates: updates({ pending: Array.from({ length: 5001 }, () => updates().pending[1]) }),
      }),
    ).expect(400);
  });

  it("is invisible to other tenants", async () => {
    const stranger = await signIn(t, other.tenantId, other.owner);
    const fleet = FleetUpdatesSchema.parse(
      (await stranger.get("/api/v1/server-updates").expect(200)).body,
    );
    expect(fleet.servers).toEqual([]);
  });
});

describe("windows hosts", () => {
  let token: string;
  let serverId: string;
  const windowsReport = (overrides: Record<string, unknown> = {}) =>
    inventory(machine(40), {
      hostname: "WS-0042",
      os: {
        id: "windows",
        name: "Windows 11 Pro",
        version: "24H2",
        prettyName: "Windows 11 Pro 24H2",
        kernel: "10.0.26100.4652",
        arch: "amd64",
      },
      loadAverage: null,
      disks: [{ mount: "C:\\", device: "C:", fsType: "NTFS", sizeBytes: 100, usedBytes: 60 }],
      interfaces: [
        { name: "Ethernet", mac: "00:50:56:aa:bb:01", addresses: ["192.168.197.42/24"] },
      ],
      services: [{ name: "TermService", description: "Remote Desktop Services" }],
      packages: [{ name: "7-Zip 23.01 (x64)", version: "23.01" }],
      packageManager: "windows",
      packagesHash: "b".repeat(64),
      packageCount: 1,
      listeners: [
        { proto: "tcp", address: "::", port: 445, user: "", process: "System" },
        {
          proto: "tcp",
          address: "0.0.0.0",
          port: 3389,
          user: "",
          process: "svchost (TermService)",
        },
      ],
      firewall: {
        kind: "windows",
        active: true,
        rulesKnown: true,
        defaultAllow: false,
        zones: ["private"],
        allowed: [{ proto: "tcp", from: 3389, to: 3389, scope: "any" }],
      },
      ssh: {
        present: false,
        ports: [],
        permitRootLogin: "",
        passwordAuthentication: "",
        kbdInteractiveAuthentication: "",
        usePam: "",
        permitEmptyPasswords: "",
      },
      updates: {
        status: "ok",
        error: "",
        manager: "windows-update",
        checkedAt: new Date().toISOString(),
        metadataAt: new Date().toISOString(),
        pending: [
          {
            name: "2026-11 Cumulative Update for Windows 11 Version 24H2 (KB5070001)",
            arch: "",
            version: "KB5070001",
            security: true,
            severity: "Critical",
            advisory: "KB5070001",
          },
        ],
        rebootRequired: true,
        runningKernel: "10.0.26100.4652",
        newestKernel: "",
      },
      windows: {
        server: false,
        antivirus: [{ name: "Windows Defender", enabled: false, upToDate: true }],
        defender: {
          antivirusEnabled: true,
          realTimeProtection: false,
          tamperProtection: false,
          signaturesUpdatedAt: new Date().toISOString(),
        },
        bitlocker: "off",
        systemDrive: "C:",
        rdp: { enabled: true, nla: false, port: 3389 },
        smb1: false,
        uac: true,
        guestEnabled: false,
        secureBoot: true,
        admins: ["WS-0042\\Administrator", "ACME\\Domain Admins"],
        firewallProfiles: [
          { name: "domain", active: false, enabled: true, defaultInboundAllow: false },
          { name: "private", active: true, enabled: true, defaultInboundAllow: false },
          { name: "public", active: false, enabled: false, defaultInboundAllow: false },
        ],
      },
      ...overrides,
    });

  it("reports a Windows computer's posture, exposure and updates as findings", async () => {
    const issued = await newKey(acme, { name: "windows" });
    const res = await enroll(issued.key, machine(40), "WS-0042").expect(200);
    token = res.body.agentToken;
    serverId = res.body.serverId;
    await report(token, windowsReport()).expect(204);

    const admin = await signIn(t, acme.tenantId, acme.admin);
    const detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(detail).toMatchObject({
      os: { id: "windows", prettyName: "Windows 11 Pro 24H2", kernel: "10.0.26100.4652" },
      loadAverage: null,
      packageManager: "windows",
    });
    expect(detail.exposure!.windows!.bitlocker).toBe("off");
    expect(detail.exposure!.listeners.map((l) => [l.port, l.reach, l.service])).toEqual([
      [445, "blocked", "SMB"],
      [3389, "allowed", "Remote Desktop"],
    ]);
    expect(detail.exposure!.findings.map((f) => [f.key, f.severity])).toEqual([
      ["windows.antivirus_off", "high"],
      ["windows.rdp_no_nla", "high"],
      ["port.exposed:tcp:3389", "medium"],
      ["windows.bitlocker_off", "medium"],
      ["windows.firewall_profile_off", "medium"],
    ]);
    expect(detail.patchFindings.map((f) => [f.key, f.severity])).toEqual([
      ["updates.security", "high"],
      ["updates.reboot_required", "medium"],
    ]);
    expect(detail.patchFindings[0]!.remedy).toContain("Windows Update");
    expect(detail.findings).toEqual({ high: 3, medium: 4, low: 0 });

    const fleet = FleetUpdatesSchema.parse(
      (await admin.get("/api/v1/server-updates").expect(200)).body,
    );
    expect(fleet.servers.find((x) => x.serverId === serverId)).toMatchObject({
      os: "Windows 11 Pro 24H2",
      updates: { security: 1, urgent: 1, rebootRequired: true },
    });
  });

  it("a Windows posture finding can be accepted, and fixing it clears it", async () => {
    const admin = await signIn(t, acme.tenantId, acme.admin);
    await admin
      .put(`/api/v1/servers/${serverId}/findings/windows.bitlocker_off/acceptance`)
      .send({ reason: "Lab machine, no data at rest" })
      .expect(200);
    let detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(
      detail.exposure!.findings.find((f) => f.key === "windows.bitlocker_off")!.accepted,
    ).toMatchObject({ reason: "Lab machine, no data at rest" });

    const fixed = windowsReport();
    Object.assign((fixed as unknown as { windows: Record<string, unknown> }).windows, {
      antivirus: [{ name: "Windows Defender", enabled: true, upToDate: true }],
      defender: {
        antivirusEnabled: true,
        realTimeProtection: true,
        tamperProtection: true,
        signaturesUpdatedAt: new Date().toISOString(),
      },
      rdp: { enabled: true, nla: true, port: 3389 },
    });
    await report(token, fixed).expect(204);
    detail = ServerDetailSchema.parse(
      (await admin.get(`/api/v1/servers/${serverId}`).expect(200)).body,
    );
    expect(detail.exposure!.findings.map((f) => f.key)).toEqual([
      "port.exposed:tcp:3389",
      "windows.bitlocker_off",
      "windows.firewall_profile_off",
    ]);
  });

  it("refuses malformed Windows reports", async () => {
    const bad = windowsReport();
    (bad as unknown as { windows: Record<string, unknown> }).windows.bitlocker = "maybe";
    await report(token, bad).expect(400);
    await report(token, windowsReport({ packageManager: "chocolatey" })).expect(400);
  });
});

describe("installer", () => {
  it("serves an install script that verifies the binary checksum", async () => {
    const res = await request(t.http).get("/api/agent/v1/install.sh").expect(200);
    const sum = createHash("sha256").update(fakeBinary).digest("hex");
    expect(res.text).toContain(`SUM_amd64='${sum}'`);
    expect(res.text).toContain("checksum mismatch: refusing to install");
    expect(res.text).toContain("NoNewPrivileges=yes");
    expect(res.text).toContain("ReadWritePaths=-/var/cache/dnf");
  });

  it("serves a PowerShell installer that verifies the binary and locks down the credential", async () => {
    const res = await request(t.http).get("/api/agent/v1/install.ps1").expect(200);
    const sum = createHash("sha256").update(fakeExe).digest("hex");
    expect(res.text).toContain(`amd64 = '${sum}'; arm64 = ''`);
    expect(res.text).toContain("Checksum mismatch: refusing to install.");
    expect(res.text).toContain("'*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'");
    expect(res.text).toContain("/api/agent/v1/download/windows-$arch");
    // The script must parse; checked with PowerShell where it's installed (Windows, CI runners).
    const shell = ["pwsh", "powershell"].find((s) => spawnSync(s, ["-v"]).error === undefined);
    if (shell) {
      const dir = mkdtempSync(join(tmpdir(), "nf-ps-"));
      const file = join(dir, "install.ps1");
      writeFileSync(file, res.text);
      const check = spawnSync(shell, [
        "-NoProfile",
        "-Command",
        `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.ToString() }; exit 1 }`,
      ]);
      expect(check.stdout.toString() + check.stderr.toString()).toBe("");
      expect(check.status).toBe(0);
    }
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
    const exe = await request(t.http).get("/api/agent/v1/download/windows-amd64").expect(200);
    expect(exe.headers["content-disposition"]).toContain("nf-agent-windows-amd64.exe");
    await request(t.http).get("/api/agent/v1/download/windows-arm64").expect(404);
    await request(t.http).get("/api/agent/v1/download/windows-..").expect(404);
    await request(t.http).get("/api/agent/v1/download/..%2f..%2fetc%2fpasswd").expect(404);
  });
});
