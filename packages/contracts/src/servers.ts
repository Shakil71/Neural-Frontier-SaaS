import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Linux server inventory reported by the Neural Frontier agent (agents/linux).
 * Every field is bounded so a misbehaving agent can't store unbounded data.
 */
const short = (n: number) => z.string().max(n);

export const AgentDiskSchema = z.object({
  mount: short(512),
  device: short(256),
  fsType: short(32),
  sizeBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative(),
});
export type AgentDisk = z.infer<typeof AgentDiskSchema>;

export const AgentInterfaceSchema = z.object({
  name: short(64),
  mac: short(32),
  addresses: z.array(short(64)).max(32),
});

export const AgentServiceSchema = z.object({
  name: short(256),
  description: short(512),
});

export const AgentPackageSchema = z.object({
  name: short(256),
  version: short(128),
});
export type AgentPackage = z.infer<typeof AgentPackageSchema>;

const port = z.number().int().min(0).max(65535);
const Proto = z.enum(["tcp", "udp"]);

/** A socket waiting for connections (Phase 4a). */
export const AgentListenerSchema = z.object({
  proto: Proto,
  address: short(64),
  port,
  user: short(64),
  /** Empty when the agent may not see the owning process. */
  process: short(64),
});
export type AgentListener = z.infer<typeof AgentListenerSchema>;

/** Traffic a firewall lets in: from anywhere, or only from specific sources ("limited"). */
export const AgentPortRangeSchema = z.object({
  proto: Proto,
  from: port,
  to: port,
  scope: z.enum(["any", "limited"]),
});
export type AgentPortRange = z.infer<typeof AgentPortRangeSchema>;

export const FirewallKindSchema = z.enum(["firewalld", "ufw", "nftables", "iptables", "none"]);

export const AgentFirewallSchema = z.object({
  kind: FirewallKindSchema,
  active: z.boolean(),
  /** False when a firewall runs but its rules can't be read without CAP_NET_ADMIN. */
  rulesKnown: z.boolean(),
  /** Incoming traffic is accepted unless a rule blocks it. */
  defaultAllow: z.boolean(),
  zones: z.array(short(64)).max(64),
  allowed: z.array(AgentPortRangeSchema).max(1024),
});
export type AgentFirewall = z.infer<typeof AgentFirewallSchema>;

/** Effective sshd settings (global section; Match blocks are not evaluated). */
export const AgentSshSchema = z.object({
  present: z.boolean(),
  ports: z.array(port).max(16),
  permitRootLogin: short(32),
  passwordAuthentication: short(32),
  kbdInteractiveAuthentication: short(32),
  usePam: short(32),
  permitEmptyPasswords: short(32),
});
export type AgentSsh = z.infer<typeof AgentSshSchema>;

export const AgentInventorySchema = z.object({
  agentVersion: short(64),
  collectedAt: z.iso.datetime(),
  hostname: short(253).min(1),
  machineId: z.string().regex(/^[0-9a-f]{32}$/, "machine-id must be 32 hex characters"),
  os: z.object({
    id: short(64),
    name: short(128),
    version: short(64),
    prettyName: short(256),
    kernel: short(128),
    arch: short(32),
  }),
  cpu: z.object({ model: short(256), cores: z.number().int().min(0).max(4096) }),
  memory: z.object({
    totalBytes: z.number().int().nonnegative(),
    availableBytes: z.number().int().nonnegative(),
  }),
  uptimeSeconds: z.number().int().nonnegative(),
  loadAverage: z.tuple([z.number(), z.number(), z.number()]),
  disks: z.array(AgentDiskSchema).max(128),
  interfaces: z.array(AgentInterfaceSchema).max(64),
  services: z.array(AgentServiceSchema).max(2000),
  /** Omitted when unchanged since the last report (see packagesHash). */
  packages: z.array(AgentPackageSchema).max(10_000).optional(),
  packageManager: z.enum(["rpm", "dpkg", "none"]),
  packagesHash: short(64),
  packageCount: z.number().int().nonnegative(),
  /** Network exposure; absent from agents released before Phase 4a. */
  listeners: z.array(AgentListenerSchema).max(512).optional(),
  firewall: AgentFirewallSchema.optional(),
  ssh: AgentSshSchema.optional(),
});
export type AgentInventory = z.infer<typeof AgentInventorySchema>;

export const AgentEnrollRequestSchema = z.object({
  enrollmentKey: z.string().min(10).max(128),
  machineId: z.string().regex(/^[0-9a-f]{32}$/),
  hostname: z.string().min(1).max(253),
});

export const AgentEnrollResponseSchema = z.object({
  serverId: IdSchema,
  /** Bearer credential for /api/agent/v1/*. Stored by the agent in a root-only file. */
  agentToken: z.string(),
  intervalSeconds: z.number().int(),
});

export const ServerStatusSchema = z.enum(["online", "stale", "offline", "retired"]);
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const FindingSeveritySchema = z.enum(["high", "medium", "low"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

/** Stable identifier of a finding on one server, e.g. "port.exposed:tcp:3306". */
export const FindingKeySchema = z.string().regex(/^[a-z0-9._:-]{1,128}$/);

export const FindingAcceptanceSchema = z.object({
  reason: z.string(),
  acceptedBy: z.string(),
  acceptedAt: z.iso.datetime(),
});

export const ServerFindingSchema = z.object({
  key: FindingKeySchema,
  severity: FindingSeveritySchema,
  title: z.string(),
  detail: z.string(),
  /** What to change on the server to resolve it. */
  remedy: z.string(),
  /** Set when an administrator accepted the risk; accepted findings don't count as open. */
  accepted: FindingAcceptanceSchema.nullable(),
});
export type ServerFinding = z.infer<typeof ServerFindingSchema>;

export const FindingCountsSchema = z.object({
  high: z.number().int(),
  medium: z.number().int(),
  low: z.number().int(),
});
export type FindingCounts = z.infer<typeof FindingCountsSchema>;

/**
 * Where a listener can be reached from: loopback (this machine only), a private network
 * address, a public address, or every interface.
 */
export const ListenerScopeSchema = z.enum(["loopback", "private", "public", "all"]);
/**
 * What the firewall does with traffic to it: open (no firewall, or default-allow), allowed from
 * anywhere, allowed only from some sources (limited), blocked, or unknown (rules unreadable).
 * Loopback listeners are "local".
 */
export const ListenerReachSchema = z.enum([
  "local",
  "open",
  "allowed",
  "limited",
  "blocked",
  "unknown",
]);
export type ListenerReach = z.infer<typeof ListenerReachSchema>;

export const ServerListenerSchema = AgentListenerSchema.extend({
  scope: ListenerScopeSchema,
  reach: ListenerReachSchema,
  /** A well-known service name for the port, when there is one. */
  service: z.string().nullable(),
});
export type ServerListener = z.infer<typeof ServerListenerSchema>;

export const ServerSummarySchema = z.object({
  id: IdSchema,
  hostname: z.string(),
  status: ServerStatusSchema,
  os: z
    .object({ id: z.string(), prettyName: z.string(), kernel: z.string(), arch: z.string() })
    .nullable(),
  cpu: z.object({ model: z.string(), cores: z.number() }).nullable(),
  memory: z.object({ totalBytes: z.number(), availableBytes: z.number() }).nullable(),
  /** Highest disk usage among mounts, 0–1. */
  diskPeak: z.number().nullable(),
  loadAverage: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  uptimeSeconds: z.number().nullable(),
  ipAddresses: z.array(z.string()),
  packageCount: z.number().int(),
  serviceCount: z.number().int(),
  agentVersion: z.string().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  enrolledAt: z.iso.datetime(),
  /** Open (not accepted) findings; null until an agent that reports exposure has reported. */
  findings: FindingCountsSchema.nullable(),
});
export type ServerSummary = z.infer<typeof ServerSummarySchema>;

export const ServerDetailSchema = ServerSummarySchema.extend({
  machineId: z.string(),
  disks: z.array(AgentDiskSchema),
  interfaces: z.array(AgentInterfaceSchema),
  services: z.array(AgentServiceSchema),
  packages: z.array(AgentPackageSchema),
  packageManager: z.string().nullable(),
  /** Null when the agent predates exposure reporting. */
  exposure: z
    .object({
      listeners: z.array(ServerListenerSchema),
      firewall: AgentFirewallSchema,
      ssh: AgentSshSchema,
      findings: z.array(ServerFindingSchema),
    })
    .nullable(),
});
export type ServerDetail = z.infer<typeof ServerDetailSchema>;

export const EnrollmentKeySchema = z.object({
  id: IdSchema,
  name: z.string(),
  hint: z.string(),
  uses: z.number().int(),
  maxUses: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});
export type EnrollmentKey = z.infer<typeof EnrollmentKeySchema>;

export const CreateEnrollmentKeySchema = z.object({
  name: z.string().trim().min(2).max(120),
  lifetimeDays: z.number().int().min(1).max(365).default(30),
  maxUses: z.number().int().min(1).max(10_000).nullable().default(null),
});

export const IssuedEnrollmentKeySchema = z.object({
  key: z.string(),
  enrollmentKey: EnrollmentKeySchema,
  /** A ready-to-paste one-line install command. */
  installCommand: z.string(),
});
export type IssuedEnrollmentKey = z.infer<typeof IssuedEnrollmentKeySchema>;

/** Every finding across the organisation's active servers (Infrastructure → Findings). */
export const TenantFindingSchema = ServerFindingSchema.extend({
  serverId: IdSchema,
  hostname: z.string(),
});
export type TenantFinding = z.infer<typeof TenantFindingSchema>;

export const TenantFindingsSchema = z.object({
  items: z.array(TenantFindingSchema),
  open: FindingCountsSchema,
  accepted: z.number().int(),
  /** Active servers whose agent reports exposure, out of all active servers. */
  serversReporting: z.number().int(),
  serversTotal: z.number().int(),
});
export type TenantFindings = z.infer<typeof TenantFindingsSchema>;

export const AcceptFindingSchema = z.object({ reason: z.string().trim().min(3).max(500) });
