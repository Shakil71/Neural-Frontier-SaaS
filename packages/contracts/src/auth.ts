import { z } from "zod";
import { IdSchema } from "./common.js";

export const SessionSchema = z.object({
  user: z.object({
    id: IdSchema,
    email: z.email(),
    displayName: z.string(),
  }),
  tenant: z.object({ id: IdSchema, name: z.string(), slug: z.string() }),
  permissions: z.array(z.string()),
  /** Send back in the `x-csrf-token` header on every state-changing request. */
  csrfToken: z.string(),
  expiresAt: z.iso.datetime(),
});
export type Session = z.infer<typeof SessionSchema>;
