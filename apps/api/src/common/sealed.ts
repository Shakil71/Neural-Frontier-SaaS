import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for credentials at rest (AES-256-GCM).
 *
 * Layout: version (1 byte) ‖ IV (12) ‖ tag (16) ‖ ciphertext.
 * `context` is bound as additional authenticated data, so a ciphertext copied to another
 * row (another tenant or connector) fails to decrypt instead of being usable there.
 */
const VERSION = 1;

export function seal(key: Buffer, plaintext: string, context: string): Uint8Array<ArrayBuffer> {
  if (key.length !== 32) throw new Error("data key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return new Uint8Array(Buffer.concat([Buffer.of(VERSION), iv, cipher.getAuthTag(), body]));
}

export function unseal(key: Buffer, sealed: Uint8Array, context: string): string {
  const buf = Buffer.from(sealed);
  if (buf.length < 29 || buf[0] !== VERSION) throw new Error("unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(1, 13));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString("utf8");
}

/** Last four characters, for "which secret is this?" without revealing it. */
export function hintOf(secret: string): string {
  return secret.length <= 8 ? "••••" : `••••${secret.slice(-4)}`;
}
