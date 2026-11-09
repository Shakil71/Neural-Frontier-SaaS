import { createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { errors, jwtVerify, SignJWT } from "jose";

/** Access tokens are short-lived; revocation is also checked on every request. */
export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const TOKEN_AUDIENCE = "nf-api";

export interface MachineClaims {
  /** Service principal id. */
  sub: string;
  /** Tenant id. */
  tid: string;
  /** Secret id used to obtain the token, so revoking that secret kills the token. */
  sid: string;
  /** Granted permission keys. */
  scp: string[];
  jti: string;
  exp: number;
}

function signingKey(sessionSecret: string): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", sessionSecret, "neural-frontier", "machine-access-token:v1", 32),
  );
}

export async function issueAccessToken(
  sessionSecret: string,
  issuer: string,
  claims: Omit<MachineClaims, "jti" | "exp">,
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const token = await new SignJWT({ tid: claims.tid, sid: claims.sid, scp: claims.scp })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setIssuer(issuer)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(claims.sub)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(signingKey(sessionSecret));
  return { token, jti, expiresAt };
}

/** Returns the claims of a valid token, or null (bad signature, expired, wrong issuer/audience). */
export async function verifyAccessToken(
  sessionSecret: string,
  issuer: string,
  token: string,
): Promise<MachineClaims | null> {
  if (token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(sessionSecret), {
      algorithms: ["HS256"],
      issuer,
      audience: TOKEN_AUDIENCE,
      typ: "at+jwt",
    });
    const { sub, tid, sid, scp, jti, exp } = payload as Partial<MachineClaims>;
    if (
      typeof sub !== "string" ||
      typeof tid !== "string" ||
      typeof sid !== "string" ||
      typeof jti !== "string" ||
      typeof exp !== "number" ||
      !Array.isArray(scp) ||
      !scp.every((s) => typeof s === "string")
    ) {
      return null;
    }
    return { sub, tid, sid, scp, jti, exp };
  } catch (err) {
    if (err instanceof errors.JOSEError) return null;
    throw err;
  }
}

/** `nfc_` + 128 random bits. Public identifier, safe to log. */
export function newClientId(): string {
  return `nfc_${randomBytes(16).toString("hex")}`;
}

/** `nfs_` + 256 random bits. Shown once; only the SHA-256 is stored. */
export function newClientSecret(): string {
  return `nfs_${randomBytes(32).toString("base64url")}`;
}

export function hashSecret(secret: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update(secret, "utf8").digest());
}

export function sameHash(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
