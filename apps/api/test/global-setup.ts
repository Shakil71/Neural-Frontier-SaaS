import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Integration tests run against a real MySQL 8.4 (and Redis when TEST_REDIS_URL is set).
 * Applies the committed migrations exactly as production does — this doubles as
 * migration validation.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests need a disposable MySQL 8.4 database, e.g.\n" +
        "  TEST_DATABASE_URL=mysql://root:root@127.0.0.1:3306/nf_test?allowPublicKeyRetrieval=true",
    );
  }
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: resolve(import.meta.dirname, "../../../packages/db"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
