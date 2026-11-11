import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Server inventory reported by the Neural Frontier agent (agents/nf-agent), on Linux and Windows.
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

export const FirewallKindSchema = z.enum([
  "firewalld",
  "ufw",
  "nftables",
  "iptables",
  /** Windows Defender Firewall; zones are the connected profiles (domain, private, public). */
  "windows",
  "none",
]);

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

/** One package with a newer version available (Phase 4b). */
export const AgentPendingUpdateSchema = z.object({
  name: short(256),
  arch: short(32),
  version: short(128),
  security: z.boolean(),
  /** Critical, Important, Moderate or Low; "" when the distribution publishes none (Debian). */
  severity: short(32),
  advisory: short(64),
});
export type AgentPendingUpdate = z.infer<typeof AgentPendingUpdateSchema>;

export const UpdatesStatusSchema = z.enum(["ok", "unavailable", "unsupported"]);

export const AgentUpdatesSchema = z.object({
  status: UpdatesStatusSchema,
  error: short(300),
  manager: z.enum(["rpm", "dpkg", "windows-update", "none"]),
  checkedAt: z.iso.datetime(),
  /** When the package metadata was last refreshed; results are only as fresh as this. */
  metadataAt: z.iso.datetime().nullable(),
  pending: z.array(AgentPendingUpdateSchema).max(5000),
  /** Null when it can't be told (no kernel packages, unknown distribution). */
  rebootRequired: z.boolean().nullable(),
  /** The running kernel, or the OS build on Windows (10.0.20348.2700). */
  runningKernel: short(128),
  newestKernel: short(128),
});
export type AgentUpdates = z.infer<typeof AgentUpdatesSchema>;

/** Security posture of a Windows host (Phase 4c). */
export const AgentWindowsSchema = z.object({
  /** Windows Server edition. */
  server: z.boolean(),
  /** Antivirus products registered with Windows Security Center (client editions only). */
  antivirus: z
    .array(z.object({ name: short(128), enabled: z.boolean(), upToDate: z.boolean() }))
    .max(16),
  /** Null when Microsoft Defender Antivirus isn't installed or didn't answer. */
  defender: z
    .object({
      antivirusEnabled: z.boolean(),
      realTimeProtection: z.boolean(),
      tamperProtection: z.boolean().nullable(),
      signaturesUpdatedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  /** BitLocker on the system drive. */
  bitlocker: z.enum(["on", "off", "suspended", "encrypting", "unavailable", "unknown"]),
  systemDrive: short(8),
  rdp: z.object({ enabled: z.boolean(), nla: z.boolean().nullable(), port }),
  smb1: z.boolean().nullable(),
  uac: z.boolean().nullable(),
  guestEnabled: z.boolean().nullable(),
  secureBoot: z.boolean().nullable(),
  /** Members of the local Administrators group. */
  admins: z.array(short(128)).max(64),
  firewallProfiles: z
    .array(
      z.object({
        name: z.enum(["domain", "private", "public"]),
        active: z.boolean(),
        enabled: z.boolean(),
        defaultInboundAllow: z.boolean(),
      }),
    )
    .max(3),
});
export type AgentWindows = z.infer<typeof AgentWindowsSchema>;

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
  /** Null on Windows, which has no load average. */
  loadAverage: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  disks: z.array(AgentDiskSchema).max(128),
  interfaces: z.array(AgentInterfaceSchema).max(64),
  services: z.array(AgentServiceSchema).max(2000),
  /** Omitted when unchanged since the last report (see packagesHash). */
  packages: z.array(AgentPackageSchema).max(10_000).optional(),
  /** "windows": installed programs (Programs and Features). */
  packageManager: z.enum(["rpm", "dpkg", "windows", "none"]),
  packagesHash: short(64),
  packageCount: z.number().int().nonnegative(),
  /** Network exposure; absent from agents released before Phase 4a. */
  listeners: z.array(AgentListenerSchema).max(512).optional(),
  firewall: AgentFirewallSchema.optional(),
  ssh: AgentSshSchema.optional(),
  /** Patch state; absent from agents released before Phase 4b. */
  updates: AgentUpdatesSchema.optional(),
  /** Windows hosts only. */
  windows: AgentWindowsSchema.optional(),
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
  /** Patch compliance; null until an agent that reports updates has reported. */
  updates: z
    .object({
      status: UpdatesStatusSchema,
      pending: z.number().int(),
      security: z.number().int(),
      /** Security updates rated Critical or Important (RPM-based systems). */
      urgent: z.number().int(),
      rebootRequired: z.boolean().nullable(),
      checkedAt: z.iso.datetime(),
      metadataAt: z.iso.datetime().nullable(),
    })
    .nullable(),
});
export type ServerSummary = z.infer<typeof ServerSummarySchema>;

export const ServerDetailSchema = ServerSummarySchema.extend({
  machineId: z.string(),
  disks: z.array(AgentDiskSchema),
  interfaces: z.array(AgentInterfaceSchema),
  services: z.array(AgentServiceSchema),
  packages: z.array(AgentPackageSchema),
  packageManager: z.string().nullable(),
  /** Null when the agent predates update reporting. */
  patches: AgentUpdatesSchema.nullable(),
  /** Findings from the patch state (security updates, reboot, stale metadata). */
  patchFindings: z.array(ServerFindingSchema),
  /** Null when the agent predates exposure reporting. */
  exposure: z
    .object({
      listeners: z.array(ServerListenerSchema),
      firewall: AgentFirewallSchema,
      ssh: AgentSshSchema,
      /** Windows hosts only. */
      windows: AgentWindowsSchema.nullable(),
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
  /** A ready-to-paste one-line install command (Linux, as root). */
  installCommand: z.string(),
  /** The same for Windows (PowerShell as Administrator). */
  windowsInstallCommand: z.string(),
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

/** Patch compliance across the organisation's active servers (Infrastructure → Updates). */
export const FleetUpdatesSchema = z.object({
  servers: z.array(
    z.object({
      serverId: IdSchema,
      hostname: z.string(),
      os: z.string().nullable(),
      status: ServerStatusSchema,
      updates: ServerSummarySchema.shape.updates,
    }),
  ),
  /** Packages with security updates pending, across servers, most widespread first. */
  topPackages: z.array(
    z.object({
      name: z.string(),
      servers: z.number().int(),
      severity: z.string(),
      advisory: z.string(),
    }),
  ),
  totals: z.object({
    servers: z.number().int(),
    reporting: z.number().int(),
    upToDate: z.number().int(),
    withSecurity: z.number().int(),
    rebootRequired: z.number().int(),
    securityUpdates: z.number().int(),
  }),
});
export type FleetUpdates = z.infer<typeof FleetUpdatesSchema>;
