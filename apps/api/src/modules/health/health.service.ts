import { Inject, Injectable } from "@nestjs/common";
import type { DependencyStatus, HealthReport } from "@nf/contracts";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { DatabaseService } from "../../infra/database.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { OidcService } from "../auth/oidc.service.js";

const CHECK_TIMEOUT_MS = 2_000;

async function timed(name: string, fn: () => Promise<unknown>): Promise<DependencyStatus> {
  const started = performance.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), CHECK_TIMEOUT_MS),
      ),
    ]);
    return { name, status: "up", latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return {
      name,
      status: "down",
      latencyMs: null,
      detail: err instanceof Error ? err.message : "error",
    };
  }
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly oidc: OidcService,
  ) {}

  async report(): Promise<HealthReport> {
    const deps: DependencyStatus[] = [await timed("mysql", () => this.database.ping())];
    deps.push(
      this.redis.client
        ? await timed("redis", () => this.redis.ping())
        : { name: "redis", status: "not_configured", latencyMs: null },
    );
    deps.push({
      name: "sso",
      status: this.oidc.configured ? "up" : "not_configured",
      latencyMs: null,
      detail: this.oidc.configured ? "OIDC client configured" : "Set NF_OIDC_* to enable sign-in",
    });

    const mysqlUp = deps[0]!.status === "up";
    const redisDown =
      deps[1]!.status === "down" || (this.config.env === "production" && deps[1]!.status !== "up");
    return {
      status: !mysqlUp ? "down" : redisDown ? "degraded" : "ok",
      release: this.config.release,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      checkedAt: new Date().toISOString(),
      dependencies: deps,
    };
  }
}
