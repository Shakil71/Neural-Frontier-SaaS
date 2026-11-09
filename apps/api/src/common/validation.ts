import type { z } from "zod";

/** Parses untrusted input against a shared contract schema. Throws ZodError (→ 400). */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input);
}
