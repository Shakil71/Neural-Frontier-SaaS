#!/usr/bin/env node
/**
 * License compliance gate for production dependencies.
 * Fails if any package's license is not on the allowlist and has no reviewed exception.
 * Copyleft licenses that would impose obligations on Neural Frontier's own code
 * (GPL, AGPL, SSPL, …) are never allowed.
 */
import { execFileSync } from "node:child_process";

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "BlueOak-1.0.0",
  "PSF-2.0",
  "MIT and ISC",
  "MIT OR Apache-2.0",
  "(MIT OR Apache-2.0)",
  "Apache-2.0 OR MIT",
  "CC0-1.0",
]);

/** Reviewed exceptions. Every entry needs a reason; see docs/compliance/license-register.md. */
const EXCEPTIONS = {
  mariadb:
    "LGPL-2.1-or-later: unmodified database driver used as a library (Prisma adapter). Permitted.",
  "@img/sharp-*":
    "Apache-2.0 AND LGPL-3.0 (libvips), dynamically linked, unmodified. Next.js image optimisation.",
  "caniuse-lite":
    "CC-BY-4.0 data set used at build time by browserslist. Attribution in license register.",
  elkjs: "EPL-2.0, pulled in by the Prisma CLI (Studio). Not linked into application code.",
  busboy: "MIT (LICENSE file present; package.json omits the field).",
  streamsearch: "MIT (LICENSE file present; package.json omits the field).",
};
const FORBIDDEN = /\b(A?GPL|SSPL|BUSL|Commons-Clause|CC-BY-NC)/i;

const matches = (name, pattern) =>
  pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern;

const packages = JSON.parse(
  execFileSync("npm", ["query", ".prod"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const failures = [];
let checked = 0;

for (const p of packages) {
  if (!p.location || !p.location.includes("node_modules")) continue; // our own workspaces
  checked++;
  const license = typeof p.license === "string" ? p.license : (p.license?.type ?? "UNKNOWN");
  const exception = Object.keys(EXCEPTIONS).find((k) => matches(p.name, k));
  if (FORBIDDEN.test(license) && !/LGPL/i.test(license)) {
    failures.push(`${p.name}@${p.version}: ${license} is forbidden`);
  } else if (!ALLOWED.has(license) && !exception) {
    failures.push(
      `${p.name}@${p.version}: ${license} is not on the allowlist and has no reviewed exception`,
    );
  }
}

if (failures.length) {
  console.error(`License check failed (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`License check passed: ${checked} production packages.`);
