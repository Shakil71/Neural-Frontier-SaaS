import { AUDIT_ACTIONS } from "@nf/contracts";
import { describe, expect, it } from "vitest";
import { AUDIT_LABELS, auditLabel } from "./audit-labels";
import { ApiRequestError, toApiError } from "./api";
import { avatarHue, formatRelative, initials } from "./format";

describe("formatRelative", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  it("formats past times and null", () => {
    expect(formatRelative("2026-11-09T11:58:00Z", now)).toBe("2 min. ago");
    expect(formatRelative("2026-11-08T12:00:00Z", now)).toBe("yesterday");
    expect(formatRelative("2026-11-09T11:59:59Z", now)).toBe("just now");
    expect(formatRelative(null, now)).toBe("Never");
  });
});

describe("initials and avatar hue", () => {
  it("derives initials from names and emails", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("grace.hopper@navy.example")).toBe("GH");
    expect(initials("x")).toBe("X");
  });
  it("is deterministic", () => {
    expect(avatarHue("ada@x")).toBe(avatarHue("ada@x"));
    expect(avatarHue("ada@x")).toBeGreaterThanOrEqual(0);
  });
});

describe("audit labels", () => {
  it("cover every audit action in the contract", () => {
    for (const action of AUDIT_ACTIONS) expect(AUDIT_LABELS[action]).toBeDefined();
  });
  it("fall back for unknown actions", () => {
    expect(auditLabel("future.action").label).toBe("future.action");
  });
});

describe("toApiError", () => {
  it("parses the API error contract", async () => {
    const res = new Response(
      JSON.stringify({ error: { code: "conflict", message: "Stale", requestId: "r1" } }),
      { status: 409 },
    );
    const err = await toApiError(res);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 409, code: "conflict", message: "Stale", requestId: "r1" });
  });
  it("degrades gracefully for non-contract bodies", async () => {
    const err = await toApiError(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(err).toMatchObject({ status: 502, code: "internal" });
  });
});
