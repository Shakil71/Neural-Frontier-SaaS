import { readFileSync } from "node:fs";
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3401),
    NF_RELEASE: z.string().optional(),
    /** Path to a file holding the release id (written by deploy.sh). Used when NF_RELEASE is unset. */
    NF_RELEASE_FILE: z.string().optional(),
    LOG_LEVEL: z
      .enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().optional(),

    /** Public origin of the web app, e.g. https://nf.example.com. Used for redirects and Origin checks. */
    NF_PUBLIC_URL: z.url(),
    /** ≥32 random characters. Derives CSRF tokens and encrypts the OIDC login-state cookie. */
    NF_SESSION_SECRET: z.string().min(32),
    NF_COOKIE_SECURE: bool(true),
    NF_SESSION_IDLE_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(30),
    NF_SESSION_ABSOLUTE_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(7 * 24)
      .default(12),
    NF_TRUST_PROXY: z.string().default("loopback"),

    NF_OIDC_ISSUER: z.url().optional(),
    NF_OIDC_CLIENT_ID: z.string().optional(),
    NF_OIDC_CLIENT_SECRET: z.string().optional(),
    NF_OIDC_ALLOW_INSECURE_HTTP: bool(false),
    NF_OIDC_REQUIRE_EMAIL_VERIFIED: bool(true),
    NF_AUTO_PROVISION: bool(true),

    NF_API_DOCS: bool(false),
    /** Bring built-in roles up to the code catalog at start-up (off for offline tools). */
    NF_ROLE_SYNC_ON_START: bool(true),

    /** 32 random bytes, base64. Encrypts connector credentials at rest (AES-256-GCM). */
    NF_DATA_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded")
      .optional(),
    NF_GRAPH_AUTHORITY_URL: z.url().default("https://login.microsoftonline.com"),
    NF_GRAPH_API_URL: z.url().default("https://graph.microsoft.com"),
    NF_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    NF_WORKER_TENANT_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    NF_WORKER_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(2000),
    NF_JOB_LEASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(120),
  })
  .superRefine((env, ctx) => {
    const prod = env.NODE_ENV === "production";
    if (prod && !env.NF_COOKIE_SECURE)
      ctx.addIssue({
        code: "custom",
        path: ["NF_COOKIE_SECURE"],
        message: "must be true in production",
      });
    if (prod && env.NF_OIDC_ALLOW_INSECURE_HTTP)
      ctx.addIssue({
        code: "custom",
        path: ["NF_OIDC_ALLOW_INSECURE_HTTP"],
        message: "must be false in production",
      });
    if (prod && !env.REDIS_URL)
      ctx.addIssue({ code: "custom", path: ["REDIS_URL"], message: "is required in production" });
    if (prod && !env.NF_DATA_KEY)
      ctx.addIssue({ code: "custom", path: ["NF_DATA_KEY"], message: "is required in production" });
    if (prod && !env.NF_PUBLIC_URL.startsWith("https://"))
      ctx.addIssue({
        code: "custom",
        path: ["NF_PUBLIC_URL"],
        message: "must be https in production",
      });
    const oidc = [env.NF_OIDC_ISSUER, env.NF_OIDC_CLIENT_ID, env.NF_OIDC_CLIENT_SECRET];
    if (oidc.some(Boolean) && !oidc.every(Boolean))
      ctx.addIssue({
        code: "custom",
        path: ["NF_OIDC_ISSUER"],
        message: "NF_OIDC_ISSUER, NF_OIDC_CLIENT_ID and NF_OIDC_CLIENT_SECRET must be set together",
      });
  });

export interface AppConfig {
  env: "development" | "test" | "production";
  host: string;
  port: number;
  release: string;
  logLevel: string;
  databaseUrl: string;
  redisUrl: string | null;
  publicUrl: URL;
  sessionSecret: string;
  cookie: { secure: boolean; sessionName: string; loginStateName: string };
  session: { idleMs: number; absoluteMs: number };
  trustProxy: string;
  oidc: {
    issuer: URL;
    clientId: string;
    clientSecret: string;
    allowInsecureHttp: boolean;
    requireEmailVerified: boolean;
  } | null;
  autoProvision: boolean;
  apiDocs: boolean;
  roleSyncOnStart: boolean;
  /** Null outside production when NF_DATA_KEY is unset; connectors are then unavailable. */
  dataKey: Buffer | null;
  graph: { authorityUrl: string; apiUrl: string };
  worker: { concurrency: number; tenantConcurrency: number; pollMs: number; leaseMs: number };
}

export const APP_CONFIG = Symbol("APP_CONFIG");

function readRelease(path: string | undefined): string {
  if (!path) return "dev";
  try {
    return readFileSync(path, "utf8").trim().slice(0, 64) || "unknown";
  } catch {
    return "unknown";
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // `KEY=` in an env file means "not set" (e.g. SSO not configured yet), not an empty value.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    release: e.NF_RELEASE ?? readRelease(e.NF_RELEASE_FILE),
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL ?? null,
    publicUrl: new URL(e.NF_PUBLIC_URL),
    sessionSecret: e.NF_SESSION_SECRET,
    cookie: {
      secure: e.NF_COOKIE_SECURE,
      // __Host- cookies are pinned to the exact origin: Secure, Path=/, no Domain.
      sessionName: e.NF_COOKIE_SECURE ? "__Host-nf_session" : "nf_session",
      loginStateName: e.NF_COOKIE_SECURE ? "__Host-nf_login" : "nf_login",
    },
    session: {
      idleMs: e.NF_SESSION_IDLE_MINUTES * 60_000,
      absoluteMs: e.NF_SESSION_ABSOLUTE_HOURS * 3_600_000,
    },
    trustProxy: e.NF_TRUST_PROXY,
    oidc:
      e.NF_OIDC_ISSUER && e.NF_OIDC_CLIENT_ID && e.NF_OIDC_CLIENT_SECRET
        ? {
            issuer: new URL(e.NF_OIDC_ISSUER),
            clientId: e.NF_OIDC_CLIENT_ID,
            clientSecret: e.NF_OIDC_CLIENT_SECRET,
            allowInsecureHttp: e.NF_OIDC_ALLOW_INSECURE_HTTP,
            requireEmailVerified: e.NF_OIDC_REQUIRE_EMAIL_VERIFIED,
          }
        : null,
    autoProvision: e.NF_AUTO_PROVISION,
    apiDocs: e.NF_API_DOCS,
    roleSyncOnStart: e.NF_ROLE_SYNC_ON_START,
    dataKey: e.NF_DATA_KEY ? Buffer.from(e.NF_DATA_KEY, "base64") : null,
    graph: {
      authorityUrl: e.NF_GRAPH_AUTHORITY_URL.replace(/\/+$/, ""),
      apiUrl: e.NF_GRAPH_API_URL.replace(/\/+$/, ""),
    },
    worker: {
      concurrency: e.NF_WORKER_CONCURRENCY,
      tenantConcurrency: e.NF_WORKER_TENANT_CONCURRENCY,
      pollMs: e.NF_WORKER_POLL_MS,
      leaseMs: e.NF_JOB_LEASE_SECONDS * 1000,
    },
  };
}
