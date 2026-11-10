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
});
export type ServerSummary = z.infer<typeof ServerSummarySchema>;

export const ServerDetailSchema = ServerSummarySchema.extend({
  machineId: z.string(),
  disks: z.array(AgentDiskSchema),
  interfaces: z.array(AgentInterfaceSchema),
  services: z.array(AgentServiceSchema),
  packages: z.array(AgentPackageSchema),
  packageManager: z.string().nullable(),
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
