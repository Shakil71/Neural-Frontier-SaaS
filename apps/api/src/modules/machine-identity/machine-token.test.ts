import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  hashSecret,
  issueAccessToken,
  newClientId,
  newClientSecret,
  sameHash,
  verifyAccessToken,
} from "./machine-token.js";

const secret = "x".repeat(48);
const issuer = "https://nf.example.com";
const claims = { sub: "sp-1", tid: "tenant-1", sid: "secret-1", scp: ["directory.read"] };

describe("machine access tokens", () => {
  it("verifies a token it issued", async () => {
    const { token, jti } = await issueAccessToken(secret, issuer, claims);
    const verified = await verifyAccessToken(secret, issuer, token);
    expect(verified).toMatchObject({ ...claims, jti });
  });

  it("rejects tokens from another deployment, issuer or audience", async () => {
    const { token } = await issueAccessToken(secret, issuer, claims);
    expect(await verifyAccessToken("y".repeat(48), issuer, token)).toBeNull();
    expect(await verifyAccessToken(secret, "https://other.example", token)).toBeNull();
  });

  it("rejects alg=none and tampered payloads", async () => {
    const { token } = await issueAccessToken(secret, issuer, claims);
    const [h, p] = token.split(".");
    const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "at+jwt" })).toString("base64url")}.${p}.`;
    expect(await verifyAccessToken(secret, issuer, none)).toBeNull();
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), scp: ["*"] }),
    ).toString("base64url");
    expect(
      await verifyAccessToken(secret, issuer, `${h}.${forged}.${token.split(".")[2]}`),
    ).toBeNull();
  });

  it("rejects a session-style JWT without the at+jwt type", async () => {
    const { hkdfSync } = await import("node:crypto");
    const key = new Uint8Array(
      hkdfSync("sha256", secret, "neural-frontier", "machine-access-token:v1", 32),
    );
    const wrongType = await new SignJWT({ tid: "t", sid: "s", scp: [] })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setAudience("nf-api")
      .setSubject("sp")
      .setJti("j")
      .setExpirationTime("5m")
      .sign(key);
    expect(await verifyAccessToken(secret, issuer, wrongType)).toBeNull();
  });

  it("mints distinct, prefixed credentials and compares hashes in constant time", () => {
    expect(newClientId()).toMatch(/^nfc_[0-9a-f]{32}$/);
    const s = newClientSecret();
    expect(s).toMatch(/^nfs_[A-Za-z0-9_-]{43}$/);
    expect(newClientSecret()).not.toBe(s);
    expect(sameHash(hashSecret(s), hashSecret(s))).toBe(true);
    expect(sameHash(hashSecret(s), hashSecret(`${s}x`))).toBe(false);
  });
});
