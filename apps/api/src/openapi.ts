/**
 * Writes the OpenAPI document to docs/api/openapi.json without opening a port or a
 * database connection (Prisma connects lazily). CI diffs it to catch contract drift.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildOpenApi, createApp } from "./bootstrap.js";
import { loadConfig } from "./config/config.js";

const config = loadConfig({
  NODE_ENV: "development",
  DATABASE_URL: "mysql://openapi:openapi@127.0.0.1:1/openapi",
  NF_PUBLIC_URL: "http://localhost:3400",
  NF_SESSION_SECRET: "openapi-generation-only-not-a-real-secret",
  LOG_LEVEL: "error",
  NF_ROLE_SYNC_ON_START: "false",
});
const app = await createApp(config, { bufferLogs: false });
await app.init();
const out = resolve(process.argv[2] ?? "../../docs/api/openapi.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(buildOpenApi(app), null, 2)}\n`);
await app.close();
console.log(`OpenAPI written to ${out}`);
