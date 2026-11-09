import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { APP_CONFIG, type AppConfig } from "../config/config.js";

/** All Neural Frontier keys live under this prefix; the production Redis ACL user is limited to it. */
export const REDIS_PREFIX = "nf:";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  /** Null when REDIS_URL is not configured (allowed outside production). */
  readonly client: Redis | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = config.redisUrl
      ? new Redis(config.redisUrl, {
          keyPrefix: REDIS_PREFIX,
          lazyConnect: false,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
        })
      : null;
    this.client?.on("error", (err) =>
      this.logger.warn({ err: err.message }, "Redis connection error"),
    );
  }

  async ping(): Promise<void> {
    if (!this.client) throw new Error("not configured");
    await this.client.ping();
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }
}
