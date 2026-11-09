import { z } from "zod";
import { IdSchema } from "./common.js";

export const DirectoryUserSchema = z.object({
  id: IdSchema,
  connectorId: IdSchema,
  externalId: z.string(),
  userPrincipalName: z.string(),
  mail: z.string().nullable(),
  displayName: z.string(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  accountEnabled: z.boolean(),
  syncedAt: z.iso.datetime(),
});
export type DirectoryUser = z.infer<typeof DirectoryUserSchema>;

export const DirectoryGroupSchema = z.object({
  id: IdSchema,
  connectorId: IdSchema,
  externalId: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  mail: z.string().nullable(),
  securityEnabled: z.boolean(),
  mailEnabled: z.boolean(),
  /** "unified" = Microsoft 365 group; empty = classic security/distribution group. */
  groupTypes: z.array(z.string()),
  memberCount: z.number().int(),
  syncedAt: z.iso.datetime(),
});
export type DirectoryGroup = z.infer<typeof DirectoryGroupSchema>;

export const DirectoryGroupMemberSchema = z.object({
  externalId: z.string(),
  memberType: z.enum(["user", "group", "other"]),
  /** Null when the member isn't in the synced directory (e.g. a device or contact). */
  displayName: z.string().nullable(),
  detail: z.string().nullable(),
});
export type DirectoryGroupMember = z.infer<typeof DirectoryGroupMemberSchema>;

export const DirectoryQuerySchema = z.object({
  cursor: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(200).optional(),
  connectorId: IdSchema.optional(),
});
export type DirectoryQuery = z.infer<typeof DirectoryQuerySchema>;
