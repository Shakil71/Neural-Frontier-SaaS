import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit opaque session token, base64url. Only its SHA-256 is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update(token, "utf8").digest());
}

/** CSRF token bound to the session id; nothing to store, cannot be reused across sessions. */
export function csrfTokenFor(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Only same-site relative paths may be used as post-login redirects.
 * Rejects absolute URLs, protocol-relative `//host`, and backslash tricks.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (/[\u0000-\u001f]/.test(value)) return "/";
  return value;
}
