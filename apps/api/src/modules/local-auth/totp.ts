import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP), as every authenticator app
 * implements them: HMAC-SHA1, 6 digits, 30-second steps. Written on node:crypto alone.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit seed (RFC 4226 recommends ≥ 128), base32 for authenticator apps. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Checks a code against the current step and one step either side (clock drift).
 * Returns the matched step so the caller can refuse its reuse, or null.
 * Steps at or before `notAfterStep` are never accepted (replay protection).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: { nowMs?: number; notAfterStep?: number | null; window?: number } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const now = currentStep(opts.nowMs);
  const window = opts.window ?? 1;
  let matched: number | null = null;
  // Check every candidate (no early exit), so timing does not reveal which step matched.
  for (let step = now - window; step <= now + window; step++) {
    const ok = timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code));
    if (
      ok &&
      (opts.notAfterStep === null || opts.notAfterStep === undefined || step > opts.notAfterStep)
    )
      matched ??= step;
  }
  return matched;
}

/** Key URI Format understood by authenticator apps (rendered as a QR code). */
export function otpauthUri(secretBase32: string, issuer: string, account: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, "%20")}`;
}
