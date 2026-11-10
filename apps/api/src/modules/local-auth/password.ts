import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard; built into Node). Stored as
 * `scrypt$<logN>$<r>$<p>$<salt>$<hash>` so parameters can be raised later: a hash made with
 * weaker parameters is re-hashed on the next successful sign-in (`needsRehash`).
 */
const LOG_N = 15; // N = 32768 → 32 MiB per hash with r = 8
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

function derive(password: string, salt: Buffer, logN: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LEN,
      { N: 2 ** logN, r, p, maxmem: 256 * 2 ** logN * r + 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, LOG_N, R, P);
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [logN, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![logN, r, p].every((n) => Number.isInteger(n) && n > 0) || logN > 20) return false;
  const expected = Buffer.from(parts[5]!, "base64");
  const key = await derive(password, Buffer.from(parts[4]!, "base64"), logN, r, p);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt$${LOG_N}$${R}$${P}$`);
}

/**
 * A real hash of a random password: verified against when the account does not exist, so a
 * miss costs the same time as a wrong password and response time does not reveal accounts.
 */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  return dummy;
}
