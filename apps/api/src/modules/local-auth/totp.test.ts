import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";
import { base32Decode, base32Encode, currentStep, hotp, otpauthUri, verifyTotp } from "./totp.js";

const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

describe("HOTP (RFC 4226 appendix D)", () => {
  it("matches the published test values", () => {
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code));
  });
});

describe("TOTP (RFC 6238 appendix B, SHA-1)", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("t=%i → %s", (t, code) => {
    expect(hotp(RFC_SECRET, Math.floor(t / 30), 8)).toBe(code);
  });

  it("accepts the current and adjacent steps, refuses replays and others", () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    const code = (s: number) => hotp(RFC_SECRET, s);
    expect(verifyTotp(secret, code(step), { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, code(step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, code(step + 1), { nowMs: now })).toBe(step + 1);
    expect(verifyTotp(secret, code(step - 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, code(step), { nowMs: now, notAfterStep: step })).toBeNull();
    expect(verifyTotp(secret, "12345", { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, "abcdef", { nowMs: now })).toBeNull();
  });
});

describe("base32 (RFC 4648)", () => {
  it.each([
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])("%j ↔ %s", (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    expect(base32Decode(encoded).toString()).toBe(plain);
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZ1W")).toThrow();
  });
});

describe("otpauth URI", () => {
  it("is in the Key URI Format", () => {
    expect(otpauthUri("JBSWY3DPEHPK3PXP", "Neural Frontier", "ana@acme.example")).toBe(
      "otpauth://totp/Neural%20Frontier:ana%40acme.example?secret=JBSWY3DPEHPK3PXP&issuer=Neural%20Frontier&algorithm=SHA1&digits=6&period=30",
    );
  });
});

describe("password hashing", () => {
  it("verifies the right password only, with a salted, self-describing hash", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(needsRehash(a)).toBe(false);
    expect(await verifyPassword("correct horse battery staple", a)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", a)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });

  it("normalises Unicode so the same password typed differently still matches", async () => {
    const h = await hashPassword("Café-Ünïcode-pass");
    expect(await verifyPassword("Café-Ünïcode-pass", h)).toBe(true);
  });
});
