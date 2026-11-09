/**
 * Bootstrap seed: `npm run seed -w @nf/db`. Idempotent; safe to re-run.
 * Reads NF_BOOTSTRAP_* variables; refuses to guess any of them.
 */
import { bootstrapTenant } from "./bootstrap.js";
import { createPrismaClient } from "./client.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const db = createPrismaClient({ url: required("DATABASE_URL") });
try {
  const result = await bootstrapTenant(db, {
    tenantName: required("NF_BOOTSTRAP_TENANT_NAME"),
    tenantSlug: required("NF_BOOTSTRAP_TENANT_SLUG"),
    domain: required("NF_BOOTSTRAP_DOMAIN"),
    ownerEmail: required("NF_BOOTSTRAP_OWNER_EMAIL"),
    ownerName: required("NF_BOOTSTRAP_OWNER_NAME"),
  });
  console.log(JSON.stringify({ msg: "bootstrap complete", ...result }));
} finally {
  await db.$disconnect();
}
