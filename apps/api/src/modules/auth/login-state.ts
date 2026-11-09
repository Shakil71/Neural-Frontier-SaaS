import { hkdfSync } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import type { ProviderKey } from "./oidc.service.js";

/** Data carried through the IdP round-trip in an encrypted, short-lived cookie. */
export interface LoginState {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  /** Which provider the sign-in started at; the callback must complete with the same one. */
  provider: ProviderKey;
}

const TTL_SECONDS = 600;

function keyFrom(secret: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", secret, "nf-login-state", "nf-login-state-v1", 32));
}

export async function sealLoginState(secret: string, value: LoginState): Promise<string> {
  return new EncryptJWT({ ...value })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .encrypt(keyFrom(secret));
}

/** Returns null if the cookie is missing, tampered with, or expired. */
export async function openLoginState(
  secret: string,
  sealed: string | undefined,
): Promise<LoginState | null> {
  if (!sealed) return null;
  try {
    const { payload } = await jwtDecrypt(sealed, keyFrom(secret));
    const { state, nonce, codeVerifier, returnTo, provider } = payload as Record<string, unknown>;
    if ([state, nonce, codeVerifier, returnTo].some((v) => typeof v !== "string")) return null;
    // Cookies sealed before per-tenant providers existed carry no provider: they used the global one.
    const key = provider ?? "global";
    if (typeof key !== "string" || !(key === "global" || /^tenant:[0-9a-f-]{36}$/.test(key))) {
      return null;
    }
    return { state, nonce, codeVerifier, returnTo, provider: key } as LoginState;
  } catch {
    return null;
  }
}

export const LOGIN_STATE_TTL_MS = TTL_SECONDS * 1000;
