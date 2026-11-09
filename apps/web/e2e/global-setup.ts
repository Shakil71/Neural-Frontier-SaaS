import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { bootstrapTenant, createPrismaClient } from "@nf/db";

export const E2E_TENANT = {
  tenantName: "Acme Robotics",
  tenantSlug: "acme",
  domain: "acme.example",
  ownerEmail: "ada.owner@acme.example",
  ownerName: "Ada Owner",
};

/** Migrates the disposable database and bootstraps one tenant plus a second person. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL is required for end-to-end tests");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: resolve(import.meta.dirname, "../../../packages/db"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const db = createPrismaClient({ url });
  try {
    const { tenantId } = await bootstrapTenant(db, E2E_TENANT);
    await db.identity.upsert({
      where: { tenantId_email: { tenantId, email: "grace.analyst@acme.example" } },
      create: { tenantId, email: "grace.analyst@acme.example", displayName: "Grace Analyst" },
      update: {},
    });
  } finally {
    await db.$disconnect();
  }
}
