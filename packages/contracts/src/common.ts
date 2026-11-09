import { z } from "zod";

/** UUIDv7: time-ordered, so it indexes well and is safe to partition on later. */
export const IdSchema = z.uuid({ version: "v7" });

/** Every API error has this shape. `code` is stable and machine-readable. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "bad_request",
      "unauthenticated",
      "forbidden",
      "not_found",
      "conflict",
      "rate_limited",
      "validation_failed",
      "internal",
      "unavailable",
    ]),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorCode = ApiError["error"]["code"];

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
