import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  AgentInventory,
  EnrollmentKey,
  IssuedEnrollmentKey,
  FleetUpdates,
  ServerDetail,
  ServerFinding,
  ServerStatus,
  ServerSummary,
  TenantFindings,
} from "@nf/contracts";
import { Prisma } from "@nf/db";
import { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { AppError, Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { analyseListeners, countOpen, findings, hasPublicAddress } from "./exposure.js";
import { isUrgent, updateFindings, updatesSummary } from "./patches.js";
import type { CreateEnrollmentKeySchema } from "@nf/contracts";

const DAY_MS = 86_400_000;
const sha = (s: string) => new Uint8Array(createHash("sha256").update(s, "utf8").digest());
const MAX_LIVE_KEYS = 10;
export const AGENT_ARCHES = ["amd64", "arm64"] as const;
export type AgentArch = (typeof AGENT_ARCHES)[number];

type ServerRow = Prisma.ServerGetPayload<object>;
type KeyRow = Prisma.AgentEnrollmentKeyGetPayload<object>;
type AcceptanceRow = Prisma.ServerFindingAcceptanceGetPayload<object>;

/** The agent's stored inventory, minus packages (kept in their own column). */
type StoredInventory = Omit<AgentInventory, "packages">;

export class AgentAuthError extends Error {}

/** The server a request was authenticated as (agent bearer token). */
export interface AgentCaller {
  serverId: string;
  tenantId: string;
  machineId: string;
}

function keyDto(r: KeyRow): EnrollmentKey {
  return {
    id: r.id,
    name: r.name,
    hint: r.hint,
    uses: r.uses,
    maxUses: r.maxUses,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Status and DTOs ──

  status(r: ServerRow, now = Date.now()): ServerStatus {
    if (r.lifecycle === "retired") return "retired";
    if (!r.lastSeenAt) return "offline";
    const age = now - r.lastSeenAt.getTime();
    if (age <= 3 * this.config.agent.intervalSeconds * 1000) return "online";
    if (age <= DAY_MS) return "stale";
    return "offline";
  }

  /**
   * Analysis of the latest report: network exposure (4a) and patch state (4b), each null when
   * the agent predates it, with findings from both and accepted ones marked.
   */
  private analyse(r: ServerRow, acceptances: AcceptanceRow[]) {
    const inv = (r.inventory ?? null) as StoredInventory | null;
    const accepted = new Map(
      acceptances.filter((a) => a.serverId === r.id).map((a) => [a.findingKey, a]),
    );
    const mark = (f: Omit<ServerFinding, "accepted">): ServerFinding => {
      const a = accepted.get(f.key);
      return {
        ...f,
        accepted: a
          ? { reason: a.reason, acceptedBy: a.acceptedBy, acceptedAt: a.acceptedAt.toISOString() }
          : null,
      };
    };
    let exposure = null;
    if (inv?.listeners && inv.firewall && inv.ssh) {
      const listeners = analyseListeners(inv.listeners, inv.firewall);
      const list = findings({
        listeners,
        firewall: inv.firewall,
        ssh: inv.ssh,
        publicHost: hasPublicAddress(inv.interfaces.flatMap((i) => i.addresses)),
      }).map(mark);
      exposure = { listeners, firewall: inv.firewall, ssh: inv.ssh, findings: list };
    }
    const patches = inv?.updates ?? null;
    const patchFindings = patches ? updateFindings(patches).map(mark) : [];
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const all = [...(exposure?.findings ?? []), ...patchFindings].sort(
      (a, b) => rank[a.severity] - rank[b.severity] || a.key.localeCompare(b.key),
    );
    return { exposure, patches, patchFindings, all, reporting: !!exposure || !!patches };
  }

  private summary(r: ServerRow, acceptances: AcceptanceRow[]): ServerSummary {
    const inv = (r.inventory ?? null) as StoredInventory | null;
    const a = r.lifecycle === "active" ? this.analyse(r, acceptances) : null;
    const diskPeak = inv?.disks?.length
      ? Math.max(...inv.disks.map((d) => (d.sizeBytes > 0 ? d.usedBytes / d.sizeBytes : 0)))
      : null;
    return {
      id: r.id,
      hostname: r.hostname,
      status: this.status(r),
      os: inv
        ? { id: inv.os.id, prettyName: inv.os.prettyName, kernel: inv.os.kernel, arch: inv.os.arch }
        : null,
      cpu: inv ? inv.cpu : null,
      memory: inv ? inv.memory : null,
      diskPeak,
      loadAverage: inv ? inv.loadAverage : null,
      uptimeSeconds: inv ? inv.uptimeSeconds : null,
      ipAddresses: inv
        ? inv.interfaces.flatMap((i) => i.addresses.map((a) => a.split("/")[0]!)).slice(0, 16)
        : [],
      packageCount: r.packageCount,
      serviceCount: inv?.services.length ?? 0,
      agentVersion: r.agentVersion,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      enrolledAt: r.enrolledAt.toISOString(),
      findings: a?.reporting ? countOpen(a.all) : null,
      updates: a?.patches ? updatesSummary(a.patches) : null,
    };
  }

  private acceptances(tenantId: string, serverId?: string) {
    return this.database.db.serverFindingAcceptance.findMany({
      where: { tenantId, ...(serverId ? { serverId } : {}) },
    });
  }

  async list(tenantId: string): Promise<ServerSummary[]> {
    const [rows, acceptances] = await Promise.all([
      this.database.db.server.findMany({
        where: { tenantId },
        orderBy: [{ lifecycle: "asc" }, { hostname: "asc" }],
        omit: { packages: true },
      }),
      this.acceptances(tenantId),
    ]);
    return rows.map((r) => this.summary(r as ServerRow, acceptances));
  }

  async get(tenantId: string, id: string): Promise<ServerDetail> {
    const [r, acceptances] = await Promise.all([
      this.database.db.server.findUnique({ where: { id, tenantId } }),
      this.acceptances(tenantId, id),
    ]);
    if (!r) throw Errors.notFound("Server");
    const inv = (r.inventory ?? null) as StoredInventory | null;
    const a = r.lifecycle === "active" ? this.analyse(r, acceptances) : null;
    return {
      ...this.summary(r, acceptances),
      exposure: a?.exposure ?? null,
      patches: a?.patches ?? null,
      patchFindings: a?.patchFindings ?? [],
      machineId: r.machineId,
      disks: inv?.disks ?? [],
      interfaces: inv?.interfaces ?? [],
      services: inv?.services ?? [],
      packages: Array.isArray(r.packages) ? (r.packages as ServerDetail["packages"]) : [],
      packageManager: inv?.packageManager ?? null,
    };
  }

  /** Findings across the organisation's active servers: open first, most severe first. */
  async tenantFindings(tenantId: string): Promise<TenantFindings> {
    const [rows, acceptances] = await Promise.all([
      this.database.db.server.findMany({
        where: { tenantId, lifecycle: "active" },
        orderBy: { hostname: "asc" },
        omit: { packages: true },
      }),
      this.acceptances(tenantId),
    ]);
    const items: TenantFindings["items"] = [];
    let reporting = 0;
    for (const r of rows) {
      const a = this.analyse(r as ServerRow, acceptances);
      if (!a.reporting) continue;
      reporting++;
      for (const f of a.all) items.push({ ...f, serverId: r.id, hostname: r.hostname });
    }
    const rank = { high: 0, medium: 1, low: 2 } as const;
    items.sort(
      (a, b) =>
        Number(a.accepted !== null) - Number(b.accepted !== null) ||
        rank[a.severity] - rank[b.severity] ||
        a.hostname.localeCompare(b.hostname) ||
        a.key.localeCompare(b.key),
    );
    return {
      items,
      open: countOpen(items),
      accepted: items.filter((i) => i.accepted).length,
      serversReporting: reporting,
      serversTotal: rows.length,
    };
  }

  /** Patch compliance across the organisation's active servers. */
  async fleetUpdates(tenantId: string): Promise<FleetUpdates> {
    const rows = await this.database.db.server.findMany({
      where: { tenantId, lifecycle: "active" },
      orderBy: { hostname: "asc" },
      omit: { packages: true },
    });
    const servers: FleetUpdates["servers"] = [];
    const packages = new Map<string, { servers: number; severity: string; advisory: string }>();
    const totals = {
      servers: rows.length,
      reporting: 0,
      upToDate: 0,
      withSecurity: 0,
      rebootRequired: 0,
      securityUpdates: 0,
    };
    const rank = (s: string) =>
      ({ critical: 4, important: 3, moderate: 2, low: 1 })[s.toLowerCase()] ?? 0;
    for (const r of rows) {
      const inv = (r.inventory ?? null) as StoredInventory | null;
      const u = inv?.updates ?? null;
      const summary = u ? updatesSummary(u) : null;
      servers.push({
        serverId: r.id,
        hostname: r.hostname,
        os: inv?.os.prettyName ?? null,
        status: this.status(r as ServerRow),
        updates: summary,
      });
      if (!u || u.status !== "ok" || !summary) continue;
      totals.reporting++;
      if (summary.pending === 0 && !summary.rebootRequired) totals.upToDate++;
      if (summary.security > 0) totals.withSecurity++;
      if (summary.rebootRequired) totals.rebootRequired++;
      totals.securityUpdates += summary.security;
      for (const p of new Map(
        u.pending.filter((x) => x.security).map((x) => [x.name, x]),
      ).values()) {
        const cur = packages.get(p.name);
        if (!cur) {
          packages.set(p.name, { servers: 1, severity: p.severity, advisory: p.advisory });
        } else {
          cur.servers++;
          if (rank(p.severity) > rank(cur.severity)) {
            cur.severity = p.severity;
            cur.advisory = p.advisory;
          }
        }
      }
    }
    const urgencyOf = (s: string) => (isUrgent(s) ? 1 : 0);
    const topPackages = [...packages.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort(
        (a, b) =>
          urgencyOf(b.severity) - urgencyOf(a.severity) ||
          b.servers - a.servers ||
          rank(b.severity) - rank(a.severity) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 20);
    return { servers, topPackages, totals };
  }

  /**
   * Records that an administrator accepts the risk of a finding. Only a finding the server has
   * right now can be accepted, so a typo can't silence a future one.
   */
  async acceptFinding(
    actor: Principal,
    serverId: string,
    key: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<ServerFinding> {
    const tenantId = actor.tenantId;
    return this.database.db.$transaction(async (tx) => {
      const r = await tx.server.findUnique({
        where: { id: serverId, tenantId },
        omit: { packages: true },
      });
      if (!r || r.lifecycle !== "active") throw Errors.notFound("Server");
      const current = this.analyse(r as ServerRow, []).all.find((f) => f.key === key);
      if (!current) throw Errors.notFound("Finding");
      const row = await tx.serverFindingAcceptance.upsert({
        where: { tenantId_serverId_findingKey: { tenantId, serverId, findingKey: key }, tenantId },
        create: {
          tenantId,
          serverId,
          findingKey: key,
          reason,
          acceptedById: actor.identityId,
          acceptedBy: actor.email,
        },
        update: {
          reason,
          acceptedById: actor.identityId,
          acceptedBy: actor.email,
          acceptedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          tenantId,
          action: "server.finding_accepted",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "server", id: serverId, label: r.hostname },
          meta,
          metadata: { finding: key, severity: current.severity, title: current.title, reason },
        },
        tx,
      );
      return {
        ...current,
        accepted: {
          reason: row.reason,
          acceptedBy: row.acceptedBy,
          acceptedAt: row.acceptedAt.toISOString(),
        },
      };
    });
  }

  async reopenFinding(actor: Principal, serverId: string, key: string, meta: RequestMeta) {
    const tenantId = actor.tenantId;
    await this.database.db.$transaction(async (tx) => {
      const r = await tx.server.findUnique({
        where: { id: serverId, tenantId },
        select: { hostname: true },
      });
      if (!r) throw Errors.notFound("Server");
      const removed = await tx.serverFindingAcceptance.deleteMany({
        where: { tenantId, serverId, findingKey: key },
      });
      if (removed.count === 0) throw Errors.notFound("Accepted finding");
      await this.audit.record(
        {
          tenantId,
          action: "server.finding_reopened",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "server", id: serverId, label: r.hostname },
          meta,
          metadata: { finding: key },
        },
        tx,
      );
    });
  }

  /** Retiring revokes the agent credential at once; history stays in the audit log. */
  async retire(actor: Principal, id: string, reason: string, meta: RequestMeta) {
    const tenantId = actor.tenantId;
    await this.database.db.$transaction(async (tx) => {
      const r = await tx.server.findUnique({ where: { id, tenantId }, omit: { packages: true } });
      if (!r) throw Errors.notFound("Server");
      await tx.server.update({
        where: { id, tenantId },
        data: { lifecycle: "retired", agentTokenHash: null, version: { increment: 1 } },
      });
      await this.audit.record(
        {
          tenantId,
          action: "server.retired",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "server", id, label: r.hostname },
          meta,
          metadata: { reason, machineId: r.machineId },
        },
        tx,
      );
    });
  }

  // ── Enrollment keys ──

  async listKeys(tenantId: string): Promise<EnrollmentKey[]> {
    const rows = await this.database.db.agentEnrollmentKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(keyDto);
  }

  async createKey(
    actor: Principal,
    input: z.infer<typeof CreateEnrollmentKeySchema>,
    meta: RequestMeta,
  ): Promise<IssuedEnrollmentKey> {
    const tenantId = actor.tenantId;
    const key = `nfe_${randomBytes(24).toString("base64url")}`;
    const row = await this.database.db.$transaction(async (tx) => {
      const live = await tx.agentEnrollmentKey.count({
        where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (live >= MAX_LIVE_KEYS) {
        throw Errors.conflict(`Revoke an old key first (at most ${MAX_LIVE_KEYS} can be active)`);
      }
      const created = await tx.agentEnrollmentKey.create({
        data: {
          tenantId,
          name: input.name,
          keyHash: sha(key),
          hint: key.slice(-4),
          maxUses: input.maxUses,
          expiresAt: new Date(Date.now() + input.lifetimeDays * DAY_MS),
          createdById: actor.identityId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          action: "agent.enrollment_key_created",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "enrollment_key", id: created.id, label: created.name },
          meta,
          metadata: {
            hint: created.hint,
            maxUses: created.maxUses,
            expiresAt: created.expiresAt.toISOString(),
          },
        },
        tx,
      );
      return created;
    });
    return { key, enrollmentKey: keyDto(row), installCommand: this.installCommand(key) };
  }

  async revokeKey(actor: Principal, id: string, meta: RequestMeta): Promise<EnrollmentKey> {
    const tenantId = actor.tenantId;
    return this.database.db.$transaction(async (tx) => {
      const r = await tx.agentEnrollmentKey.findUnique({ where: { id, tenantId } });
      if (!r) throw Errors.notFound("Enrollment key");
      if (r.revokedAt) return keyDto(r);
      const updated = await tx.agentEnrollmentKey.update({
        where: { id, tenantId },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          tenantId,
          action: "agent.enrollment_key_revoked",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "enrollment_key", id, label: r.name },
          meta,
          metadata: { hint: r.hint },
        },
        tx,
      );
      return keyDto(updated);
    });
  }

  // ── Agent install and enrolment ──

  /** SHA-256 of the TLS certificate agents should pin (self-signed deployments only). */
  certificatePin(): string | null {
    const file = this.config.agent.tlsCertFile;
    if (!file) return null;
    try {
      return `sha256:${new X509Certificate(readFileSync(file)).fingerprint256.replaceAll(":", "").toLowerCase()}`;
    } catch (err) {
      this.logger.warn({ err: String(err), file }, "could not read the TLS certificate to pin");
      return null;
    }
  }

  installCommand(key: string): string {
    const base = this.config.publicUrl.origin;
    const insecure = this.certificatePin() ? "k" : "";
    return `curl -fsS${insecure} ${base}/api/agent/v1/install.sh | sudo sh -s -- --key ${key}`;
  }

  binaryPath(arch: AgentArch): string | null {
    const p = join(this.config.agent.distDir, `nf-agent-linux-${arch}`);
    return existsSync(p) ? p : null;
  }

  /**
   * POSIX shell installer. Verifies the downloaded binary against SHA-256 sums computed from
   * the files this release serves, enrols, and installs a hardened systemd unit.
   */
  installScript(): string {
    const base = this.config.publicUrl.origin;
    const pin = this.certificatePin();
    const sums = AGENT_ARCHES.map((a) => {
      const p = this.binaryPath(a);
      return `${a}=${p ? createHash("sha256").update(readFileSync(p)).digest("hex") : ""}`;
    });
    return `#!/bin/sh
# Neural Frontier Linux agent installer. Read-only inventory; accepts no commands.
set -eu
SERVER='${base}'
PIN='${pin ?? ""}'
${sums.map((s) => `SUM_${s.split("=")[0]}='${s.split("=")[1]}'`).join("\n")}
KEY=''
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$KEY" ] || { echo "usage: install.sh --key <enrollment key>" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64; WANT="$SUM_amd64" ;;
  aarch64|arm64) ARCH=arm64; WANT="$SUM_arm64" ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
[ -n "$WANT" ] || { echo "no agent build for $ARCH on this server" >&2; exit 1; }
CURL="curl -fsS"
[ -n "$PIN" ] && CURL="curl -fsSk"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
$CURL -o "$TMP" "$SERVER/api/agent/v1/download/$ARCH"
GOT=$(sha256sum "$TMP" | cut -d' ' -f1)
[ "$GOT" = "$WANT" ] || { echo "checksum mismatch: refusing to install" >&2; exit 1; }
install -m 0755 -o root -g root "$TMP" /usr/local/bin/nf-agent
if [ -n "$PIN" ]; then
  /usr/local/bin/nf-agent enroll --server "$SERVER" --key "$KEY" --pin "$PIN"
else
  /usr/local/bin/nf-agent enroll --server "$SERVER" --key "$KEY"
fi
cat >/etc/systemd/system/nf-agent.service <<'UNIT'
[Unit]
Description=Neural Frontier inventory agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/nf-agent run
Restart=on-failure
RestartSec=30
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
# dnf takes a lock in its cache even when answering from the cache only (dnf -C).
ReadWritePaths=-/var/cache/dnf
MemoryMax=256M
CPUQuota=20%

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now nf-agent.service
echo "Neural Frontier agent installed and reporting. Logs: journalctl -u nf-agent"
`;
  }

  /** Exchanges an enrollment key for a per-server agent token. Re-enrolling rotates the token. */
  async enroll(
    input: { enrollmentKey: string; machineId: string; hostname: string },
    meta: RequestMeta,
  ): Promise<{ serverId: string; agentToken: string; intervalSeconds: number }> {
    // Cross-tenant by definition: the key identifies the tenant.
    const key = await this.database.system.agentEnrollmentKey.findUnique({
      where: { keyHash: sha(input.enrollmentKey) },
      include: { tenant: true },
    });
    const now = new Date();
    if (
      !key ||
      key.revokedAt ||
      key.expiresAt <= now ||
      key.tenant.status !== "active" ||
      (key.maxUses !== null && key.uses >= key.maxUses)
    ) {
      throw Errors.unauthenticated("Invalid, expired or used-up enrollment key");
    }
    const tenantId = key.tenantId;
    const token = `nfa_${randomBytes(32).toString("base64url")}`;
    const hostname = input.hostname.slice(0, 253);
    const serverId = await this.database.db.$transaction(async (tx) => {
      // Count the use atomically so maxUses can't be exceeded by parallel enrolments.
      const used = await tx.agentEnrollmentKey.updateMany({
        where: {
          id: key.id,
          tenantId,
          ...(key.maxUses !== null ? { uses: { lt: key.maxUses } } : {}),
        },
        data: { uses: { increment: 1 } },
      });
      if (used.count === 0) throw Errors.unauthenticated("Enrollment key is used up");
      const existing = await tx.server.findUnique({
        where: { tenantId_machineId: { tenantId, machineId: input.machineId }, tenantId },
        omit: { packages: true },
      });
      const server = existing
        ? await tx.server.update({
            where: { id: existing.id, tenantId },
            data: {
              hostname,
              lifecycle: "active",
              agentTokenHash: sha(token),
              enrolledViaKey: key.id,
              enrolledAt: now,
              version: { increment: 1 },
            },
          })
        : await tx.server.create({
            data: {
              tenantId,
              hostname,
              machineId: input.machineId,
              agentTokenHash: sha(token),
              enrolledViaKey: key.id,
            },
          });
      await this.audit.record(
        {
          tenantId,
          action: "server.enrolled",
          outcome: "success",
          actor: { id: key.id, label: `enrollment-key:${key.name}` },
          target: { type: "server", id: server.id, label: hostname },
          meta,
          metadata: { machineId: input.machineId, reEnrolled: Boolean(existing) },
        },
        tx,
      );
      return server.id;
    });
    return { serverId, agentToken: token, intervalSeconds: this.config.agent.intervalSeconds };
  }

  async authenticateAgent(header: string | undefined): Promise<AgentCaller> {
    const m = /^Bearer (nfa_[A-Za-z0-9_-]{43})$/.exec(header ?? "");
    if (!m) throw new AgentAuthError("Agent token required");
    const r = await this.database.system.server.findUnique({
      where: { agentTokenHash: sha(m[1]!) },
      select: {
        id: true,
        tenantId: true,
        machineId: true,
        lifecycle: true,
        tenant: { select: { status: true } },
      },
    });
    if (!r || r.lifecycle !== "active" || r.tenant.status !== "active") {
      throw new AgentAuthError("Unknown or retired agent");
    }
    return { serverId: r.id, tenantId: r.tenantId, machineId: r.machineId };
  }

  /**
   * Stores a report. Packages may be omitted when unchanged (same hash); if the server doesn't
   * have that list, it answers 409 and the agent sends the full report next time.
   */
  async ingest(caller: AgentCaller, inv: AgentInventory): Promise<void> {
    if (inv.machineId !== caller.machineId) {
      // A credential copied to another machine.
      throw Errors.forbidden("This agent token belongs to a different machine");
    }
    const { tenantId, serverId } = caller;
    const current = await this.database.db.server.findUnique({
      where: { id: serverId, tenantId },
      select: { packagesHash: true },
    });
    const packagesProvided = inv.packages !== undefined;
    if (!packagesProvided && inv.packageCount > 0 && current?.packagesHash !== inv.packagesHash) {
      throw new AppError("conflict", 409, "packages_required");
    }
    const { packages, ...rest } = inv;
    await this.database.db.server.update({
      where: { id: serverId, tenantId },
      data: {
        hostname: inv.hostname,
        agentVersion: inv.agentVersion,
        inventory: rest as unknown as Prisma.InputJsonValue,
        ...(packagesProvided
          ? { packages: packages as unknown as Prisma.InputJsonValue }
          : inv.packageCount === 0
            ? { packages: [] }
            : {}),
        packagesHash: inv.packagesHash,
        packageCount: inv.packageCount,
        lastSeenAt: new Date(),
      },
    });
  }
}
