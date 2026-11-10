import { describe, expect, it } from "vitest";
import { csrfTokenFor, hashToken, newSessionToken, safeEqual, safeReturnTo } from "./tokens.js";

describe("session tokens", () => {
  it("are 256-bit, unique, and hashed to 32 bytes", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(hashToken(a)).toHaveLength(32);
    expect(Buffer.from(hashToken(a)).equals(Buffer.from(hashToken(a)))).toBe(true);
  });
});

describe("CSRF tokens", () => {
  it("are bound to the session and the secret", () => {
    const s = "x".repeat(32);
    expect(csrfTokenFor(s, "session-a")).toBe(csrfTokenFor(s, "session-a"));
    expect(csrfTokenFor(s, "session-a")).not.toBe(csrfTokenFor(s, "session-b"));
    expect(csrfTokenFor(s, "session-a")).not.toBe(csrfTokenFor("y".repeat(32), "session-a"));
  });

  it("compare safely, including different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "abc")).toBe(false);
  });
});

describe("safeReturnTo (open-redirect protection)", () => {
  it.each([
    ["/identities?status=active", "/identities?status=active"],
    ["/", "/"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/path",
    "/\\evil.example",
    "javascript:alert(1)",
    "identities",
    "/\u0000x",
    undefined,
    42,
    "/" + "a".repeat(2100),
  ])("rejects %s", (input) => {
    expect(safeReturnTo(input)).toBe("/");
  });
});
