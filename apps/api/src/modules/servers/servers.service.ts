import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  AgentInventory,
  EnrollmentKey,
  IssuedEnrollmentKey,
  ServerDetail,
  ServerStatus,
  ServerSummary,
} from "@nf/contracts";
import { Prisma } from "@nf/db";
import { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { AppError, Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { CreateEnrollmentKeySchema } from "@nf/contracts";

const DAY_MS = 86_400_000;
const sha = (s: string) => new Uint8Array(createHash("sha256").update(s, "utf8").digest());
const MAX_LIVE_KEYS = 10;
export const AGENT_ARCHES = ["amd64", "arm64"] as const;
export type AgentArch = (typeof AGENT_ARCHES)[number];

type ServerRow = Prisma.ServerGetPayload<object>;
type KeyRow = Prisma.AgentEnrollmentKeyGetPayload<object>;

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

  private summary(r: ServerRow): ServerSummary {
    const inv = (r.inventory ?? null) as StoredInventory | null;
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
    };
  }

  async list(tenantId: string): Promise<ServerSummary[]> {
    const rows = await this.database.db.server.findMany({
      where: { tenantId },
      orderBy: [{ lifecycle: "asc" }, { hostname: "asc" }],
      omit: { packages: true },
    });
    return rows.map((r) => this.summary(r as ServerRow));
  }

  async get(tenantId: string, id: string): Promise<ServerDetail> {
    const r = await this.database.db.server.findUnique({ where: { id, tenantId } });
    if (!r) throw Errors.notFound("Server");
    const inv = (r.inventory ?? null) as StoredInventory | null;
    return {
      ...this.summary(r),
      machineId: r.machineId,
      disks: inv?.disks ?? [],
      interfaces: inv?.interfaces ?? [],
      services: inv?.services ?? [],
      packages: Array.isArray(r.packages) ? (r.packages as ServerDetail["packages"]) : [],
      packageManager: inv?.packageManager ?? null,
    };
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
