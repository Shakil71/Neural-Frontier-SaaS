import { hkdfSync } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";

/**
 * Between "password accepted" and "second factor accepted" the browser holds this encrypted,
 * five-minute cookie — never a session. `enroll` carries the new seed while someone sets up an
 * authenticator app because their tenant requires one.
 */
export interface SecondFactorChallenge {
  tenantId: string;
  identityId: string;
  returnTo: string;
  stage: "verify" | "enroll";
  /** Base32 seed being enrolled (stage "enroll" only). */
  pendingSecret?: string;
  /** The credential version the password was checked against: a reset in between voids this. */
  credentialVersion: number;
}

export const CHALLENGE_TTL_SECONDS = 300;

function keyFrom(secret: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", secret, "nf-2fa", "nf-second-factor-v1", 32));
}

export async function sealChallenge(secret: string, c: SecondFactorChallenge): Promise<string> {
  return new EncryptJWT({ ...c })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .encrypt(keyFrom(secret));
}

export async function openChallenge(
  secret: string,
  sealed: unknown,
): Promise<SecondFactorChallenge | null> {
  if (typeof sealed !== "string" || !sealed) return null;
  try {
    const { payload } = await jwtDecrypt(sealed, keyFrom(secret));
    const p = payload as Record<string, unknown>;
    if (
      typeof p.tenantId !== "string" ||
      typeof p.identityId !== "string" ||
      typeof p.returnTo !== "string" ||
      (p.stage !== "verify" && p.stage !== "enroll") ||
      typeof p.credentialVersion !== "number" ||
      (p.stage === "enroll" && typeof p.pendingSecret !== "string")
    ) {
      return null;
    }
    return {
      tenantId: p.tenantId,
      identityId: p.identityId,
      returnTo: p.returnTo,
      stage: p.stage,
      credentialVersion: p.credentialVersion,
      ...(typeof p.pendingSecret === "string" ? { pendingSecret: p.pendingSecret } : {}),
    };
  } catch {
    return null;
  }
}
