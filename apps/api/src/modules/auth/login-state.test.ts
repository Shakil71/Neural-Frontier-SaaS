import { describe, expect, it } from "vitest";
import { openLoginState, sealLoginState } from "./login-state.js";

const secret = "s".repeat(40);
const state = {
  state: "st",
  nonce: "no",
  codeVerifier: "cv",
  returnTo: "/audit",
  provider: "global" as const,
};

describe("login state cookie", () => {
  it("round-trips", async () => {
    expect(await openLoginState(secret, await sealLoginState(secret, state))).toEqual(state);
  });

  it("is encrypted (no plaintext PKCE verifier in the cookie)", async () => {
    const sealed = await sealLoginState(secret, { ...state, codeVerifier: "VERY-SECRET-VERIFIER" });
    expect(sealed).not.toContain("VERY-SECRET-VERIFIER");
    expect(Buffer.from(sealed.split(".")[0]!, "base64url").toString()).toContain("A256GCM");
  });

  it("rejects a different secret, tampering, garbage and absence", async () => {
    const sealed = await sealLoginState(secret, state);
    expect(await openLoginState("t".repeat(40), sealed)).toBeNull();
    const parts = sealed.split(".");
    parts[3] = parts[3]!.replace(/^./, (c) => (c === "A" ? "B" : "A"));
    expect(await openLoginState(secret, parts.join("."))).toBeNull();
    expect(await openLoginState(secret, "not-a-jwe")).toBeNull();
    expect(await openLoginState(secret, undefined)).toBeNull();
  });
});

describe("login state provider binding", () => {
  it("keeps a tenant provider key and rejects malformed ones", async () => {
    const tenant = { ...state, provider: "tenant:0192f1a0-0000-7000-8000-00000000000c" as const };
    expect(await openLoginState(secret, await sealLoginState(secret, tenant))).toEqual(tenant);
    const bad = { ...state, provider: "tenant:../../etc" as never };
    expect(await openLoginState(secret, await sealLoginState(secret, bad))).toBeNull();
  });
});
