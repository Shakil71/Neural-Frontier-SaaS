import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  createPrismaClient,
  type PrismaClient,
  type ScopedPrismaClient,
  withTenantGuard,
} from "@nf/db";
import { APP_CONFIG, type AppConfig } from "../config/config.js";

/**
 * Two views of one connection pool:
 * - `db`: tenant-guarded. Application code uses this.
 * - `system`: unguarded. Only for operations that are cross-tenant by definition
 *   (resolving a tenant from an email domain at sign-in, health checks).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly system: PrismaClient;
  readonly db: ScopedPrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.system = createPrismaClient({ url: config.databaseUrl });
    this.db = withTenantGuard(this.system);
  }

  async ping(): Promise<void> {
    await this.system.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy() {
    await this.system.$disconnect();
  }
}
