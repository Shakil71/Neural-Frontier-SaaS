import { z } from "zod";
import { IdSchema } from "./common.js";

export const RoleSchema = z.object({
  id: IdSchema,
  key: z.string(),
  name: z.string(),
  description: z.string(),
  builtIn: z.boolean(),
  permissions: z.array(z.string()),
  memberCount: z.number().int(),
});
export type Role = z.infer<typeof RoleSchema>;

export const RoleAssignmentInputSchema = z.object({
  identityId: IdSchema,
  roleId: IdSchema,
  reason: z.string().trim().min(3).max(500),
});
export type RoleAssignmentInput = z.infer<typeof RoleAssignmentInputSchema>;
