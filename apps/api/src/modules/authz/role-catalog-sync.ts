import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { syncBuiltInRolesForAllTenants } from "@nf/db";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { DatabaseService } from "../../infra/database.service.js";

/**
 * Built-in role permissions are defined in code. When a release adds permissions (e.g. Phase 2
 * connectors), existing tenants' built-in roles are brought up to date at start-up.
 * Idempotent: unchanged roles are not written. A failure is logged, not fatal: the API still
 * starts (readiness reports the database), and the next start retries.
 */
@Injectable()
export class RoleCatalogSync implements OnApplicationBootstrap {
  private readonly logger = new Logger(RoleCatalogSync.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.roleSyncOnStart) return;
    try {
      const changed = await syncBuiltInRolesForAllTenants(this.database.system);
      if (changed > 0) {
        this.logger.log({ changed }, "built-in roles updated to the current catalog");
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "could not sync built-in roles at start-up",
      );
    }
  }
}
