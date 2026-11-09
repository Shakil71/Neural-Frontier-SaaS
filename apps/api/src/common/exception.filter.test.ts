import { type ArgumentsHost, HttpException, NotFoundException } from "@nestjs/common";
import { TenantScopeViolation } from "@nf/db";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Errors } from "./errors.js";
import { ApiExceptionFilter } from "./exception.filter.js";

function run(err: unknown) {
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ id: "req-123" }), getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(err, host);
  return {
    status: (res.status.mock.calls[0] as unknown as [number])[0],
    body: json.mock.calls[0]![0],
  };
}

describe("ApiExceptionFilter", () => {
  it("maps domain errors to their code and status", () => {
    const { status, body } = run(Errors.conflict("Stale version"));
    expect(status).toBe(409);
    expect(body).toEqual({
      error: { code: "conflict", message: "Stale version", requestId: "req-123" },
    });
  });

  it("maps Zod failures to validation_failed with field paths", () => {
    const result = z.object({ reason: z.string().min(3) }).safeParse({ reason: "x" });
    const { status, body } = run(result.error);
    expect(status).toBe(400);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details[0].path).toBe("reason");
  });

  it("maps framework HTTP errors and rate limiting", () => {
    expect(run(new NotFoundException()).body.error.code).toBe("not_found");
    expect(run(new HttpException("Too Many", 429)).body.error.code).toBe("rate_limited");
  });

  it("hides internals of unexpected errors, including tenant scope violations", () => {
    for (const err of [
      new Error("db password is hunter2"),
      new TenantScopeViolation("Identity", "findMany", "x"),
    ]) {
      const { status, body } = run(err);
      expect(status).toBe(500);
      expect(body.error).toEqual({
        code: "internal",
        message: "An unexpected error occurred",
        requestId: "req-123",
      });
    }
  });
});
