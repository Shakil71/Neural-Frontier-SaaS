import { hkdfSync } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";

/** Data carried through the IdP round-trip in an encrypted, short-lived cookie. */
export interface LoginState {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
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
    const { state, nonce, codeVerifier, returnTo } = payload as Record<string, unknown>;
    if ([state, nonce, codeVerifier, returnTo].some((v) => typeof v !== "string")) return null;
    return { state, nonce, codeVerifier, returnTo } as LoginState;
  } catch {
    return null;
  }
}

export const LOGIN_STATE_TTL_MS = TTL_SECONDS * 1000;
