import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hintOf, seal, unseal } from "./sealed.js";

const key = randomBytes(32);

describe("sealed secrets", () => {
  it("round-trips with the same key and context", () => {
    const box = seal(key, "s3cr3t-value", "tenant-a:connector-1");
    expect(unseal(key, box, "tenant-a:connector-1")).toBe("s3cr3t-value");
  });

  it("never contains the plaintext and uses a fresh IV each time", () => {
    const a = seal(key, "s3cr3t-value", "ctx");
    const b = seal(key, "s3cr3t-value", "ctx");
    expect(Buffer.from(a).includes(Buffer.from("s3cr3t-value"))).toBe(false);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("refuses a ciphertext moved to another row (context mismatch)", () => {
    const box = seal(key, "s3cr3t-value", "tenant-a:connector-1");
    expect(() => unseal(key, box, "tenant-b:connector-1")).toThrow();
  });

  it("refuses a tampered ciphertext or the wrong key", () => {
    const box = seal(key, "s3cr3t-value", "ctx");
    const tampered = new Uint8Array(box);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => unseal(key, tampered, "ctx")).toThrow();
    expect(() => unseal(randomBytes(32), box, "ctx")).toThrow();
  });

  it("hints reveal at most four characters", () => {
    expect(hintOf("abcdefghijkl")).toBe("••••ijkl");
    expect(hintOf("short")).toBe("••••");
  });
});
