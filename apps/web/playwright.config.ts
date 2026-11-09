import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end: real browser → Next.js → NestJS API → MySQL, signing in through the
 * development OIDC provider. Requires E2E_DATABASE_URL (a disposable MySQL 8.4 database)
 * and builds of @nf/api and @nf/web.
 */
const db = process.env.E2E_DATABASE_URL ?? "";
const web = "http://localhost:3400";

const apiEnv = {
  NODE_ENV: "development",
  PORT: "3401",
  DATABASE_URL: db,
  ...(process.env.E2E_REDIS_URL ? { REDIS_URL: process.env.E2E_REDIS_URL } : {}),
  NF_PUBLIC_URL: web,
  NF_SESSION_SECRET: "e2e-session-secret-e2e-session-secret-0001",
  NF_COOKIE_SECURE: "false",
  NF_OIDC_ISSUER: "http://localhost:3499",
  NF_OIDC_CLIENT_ID: "neural-frontier-dev",
  NF_OIDC_CLIENT_SECRET: "dev-secret-not-for-production",
  NF_OIDC_ALLOW_INSECURE_HTTP: "true",
  NF_RELEASE: "e2e",
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: web, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node ../../tools/dev-idp/server.js",
      url: "http://localhost:3499/.well-known/openid-configuration",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node ../api/dist/main.js",
      url: "http://127.0.0.1:3401/api/health/ready",
      env: apiEnv,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npx next start --port 3400",
      url: `${web}/sign-in`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
