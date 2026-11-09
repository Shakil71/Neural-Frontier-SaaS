import { z } from "zod";
import { IdSchema } from "./common.js";

export const IdentityStatusSchema = z.enum(["active", "suspended"]);
export type IdentityStatus = z.infer<typeof IdentityStatusSchema>;

export const IdentitySchema = z.object({
  id: IdSchema,
  email: z.email(),
  displayName: z.string(),
  status: IdentityStatusSchema,
  source: z.enum(["oidc"]),
  lastSignInAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  roles: z.array(z.object({ id: IdSchema, key: z.string(), name: z.string() })),
  version: z.number().int(),
});
export type Identity = z.infer<typeof IdentitySchema>;

export const IdentityListQuerySchema = z.object({
  cursor: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(200).optional(),
  status: IdentityStatusSchema.optional(),
});
export type IdentityListQuery = z.infer<typeof IdentityListQuerySchema>;

export const UpdateIdentityStatusSchema = z.object({
  status: IdentityStatusSchema,
  /** Optimistic concurrency: the `version` the client last saw. */
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(500),
});
export type UpdateIdentityStatus = z.infer<typeof UpdateIdentityStatusSchema>;
