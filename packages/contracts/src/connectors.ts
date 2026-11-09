import { z } from "zod";
import { IdSchema } from "./common.js";

export const ConnectorKindSchema = z.enum(["microsoft_graph"]);
export type ConnectorKind = z.infer<typeof ConnectorKindSchema>;

export const ConnectorStatusSchema = z.enum(["active", "disabled"]);
export const SyncRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export type SyncRunStatus = z.infer<typeof SyncRunStatusSchema>;

/** Entra directory (tenant) id: a GUID or a verified domain such as contoso.onmicrosoft.com. */
export const DirectoryIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/,
    "Enter the directory (tenant) ID as a GUID or a domain like contoso.onmicrosoft.com",
  );

export const GraphApplicationIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "Enter the application (client) ID GUID",
  );

export const SyncIntervalSchema = z
  .number()
  .int()
  .refine((v) => v === 0 || (v >= 15 && v <= 24 * 60), "Use 0 (manual) or 15–1440 minutes");

export const ConnectorSchema = z.object({
  id: IdSchema,
  kind: ConnectorKindSchema,
  name: z.string(),
  status: ConnectorStatusSchema,
  config: z.object({ directoryId: z.string(), clientId: z.string() }),
  /** Last characters of the stored credential, so admins can tell which secret is in use. */
  secretHint: z.string().nullable(),
  syncIntervalMinutes: z.number().int(),
  lastSyncAt: z.iso.datetime().nullable(),
  lastSyncStatus: SyncRunStatusSchema.nullable(),
  counts: z.object({ users: z.number().int(), groups: z.number().int() }),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
});
export type Connector = z.infer<typeof ConnectorSchema>;

export const CreateConnectorSchema = z.object({
  kind: z.literal("microsoft_graph"),
  name: z.string().trim().min(2).max(120),
  directoryId: DirectoryIdSchema,
  clientId: GraphApplicationIdSchema,
  clientSecret: z.string().min(8).max(1024),
  syncIntervalMinutes: SyncIntervalSchema.default(60),
});
export type CreateConnector = z.infer<typeof CreateConnectorSchema>;

export const UpdateConnectorSchema = z.object({
  version: z.number().int().nonnegative(),
  name: z.string().trim().min(2).max(120).optional(),
  status: ConnectorStatusSchema.optional(),
  syncIntervalMinutes: SyncIntervalSchema.optional(),
  /** Replaces the stored credential (rotation). */
  clientSecret: z.string().min(8).max(1024).optional(),
});
export type UpdateConnector = z.infer<typeof UpdateConnectorSchema>;

export const DeleteConnectorSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const SyncRunSchema = z.object({
  id: IdSchema,
  connectorId: IdSchema,
  status: SyncRunStatusSchema,
  trigger: z.enum(["manual", "schedule"]),
  mode: z.enum(["full", "delta"]).nullable(),
  attempts: z.number().int(),
  usersUpserted: z.number().int(),
  usersRemoved: z.number().int(),
  groupsUpserted: z.number().int(),
  groupsRemoved: z.number().int(),
  membershipsChanged: z.number().int(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type SyncRun = z.infer<typeof SyncRunSchema>;

export const ConnectionTestSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  checkedAt: z.iso.datetime(),
});
export type ConnectionTest = z.infer<typeof ConnectionTestSchema>;
