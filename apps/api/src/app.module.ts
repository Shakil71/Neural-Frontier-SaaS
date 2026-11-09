import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import type { Request } from "express";
import { LoggerModule } from "nestjs-pino";
import { ApiExceptionFilter } from "./common/exception.filter.js";
import { resolveRequestId } from "./common/request.js";
import type { AppConfig } from "./config/config.js";
import { InfraModule } from "./infra/infra.module.js";
import { RedisService } from "./infra/redis.service.js";
import { RedisThrottlerStorage } from "./infra/throttler-storage.js";
import { AuditController } from "./modules/audit/audit.controller.js";
import { AuditService } from "./modules/audit/audit.service.js";
import { AuthController } from "./modules/auth/auth.controller.js";
import { OidcService } from "./modules/auth/oidc.service.js";
import { ProvisioningService } from "./modules/auth/provisioning.service.js";
import { SecurityGuard } from "./modules/auth/security.guard.js";
import { SessionService } from "./modules/auth/session.service.js";
import { AuthorizationService } from "./modules/authz/authorization.service.js";
import { DashboardController } from "./modules/dashboard/dashboard.controller.js";
import { DashboardService } from "./modules/dashboard/dashboard.service.js";
import { HealthController } from "./modules/health/health.controller.js";
import { HealthService } from "./modules/health/health.service.js";
import { IdentitiesController } from "./modules/identities/identities.controller.js";
import { IdentitiesService } from "./modules/identities/identities.service.js";
import { MetricsController, MetricsMiddleware } from "./modules/metrics/metrics.js";
import { RolesController } from "./modules/roles/roles.controller.js";
import { RolesService } from "./modules/roles/roles.service.js";
import { TenantController } from "./modules/tenant/tenant.controller.js";
import { IdentityProviderService } from "./modules/tenant/identity-provider.service.js";
import { ScimController } from "./modules/scim/scim.controller.js";
import {
  ScimAuthGuard,
  ScimTokensController,
  ScimTokensService,
} from "./modules/scim/scim-tokens.js";
import { ScimUsersService } from "./modules/scim/scim-users.service.js";
import { RoleCatalogSync } from "./modules/authz/role-catalog-sync.js";
import { BearerResolver } from "./modules/auth/security.guard.js";
import { ConnectorsController } from "./modules/connectors/connectors.controller.js";
import { ConnectorsService } from "./modules/connectors/connectors.service.js";
import { DirectoryController } from "./modules/directory/directory.controller.js";
import { DirectoryService } from "./modules/directory/directory.service.js";
import { JobQueue } from "./modules/jobs/job-queue.js";
import {
  OAuthController,
  ServicePrincipalsController,
} from "./modules/machine-identity/service-principals.controller.js";
import { ServicePrincipalsService } from "./modules/machine-identity/service-principals.service.js";

/**
 * Modular monolith root. Domains (auth, authz, audit, identities, roles, tenant, dashboard, connectors,
 * directory, machine identity, jobs)
 * are separate folders with explicit service boundaries; extract to services only when
 * scale or isolation requires it (see docs/adr/0002-modular-monolith.md).
 */
@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfraModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            genReqId: (req, res) => {
              const id = resolveRequestId(req.headers["x-request-id"]);
              res.setHeader("x-request-id", id);
              return id;
            },
            redact: {
              paths: [
                "req.headers.cookie",
                "req.headers.authorization",
                'req.headers["x-csrf-token"]',
                'res.headers["set-cookie"]',
              ],
              censor: "[redacted]",
            },
            customProps: (req) => {
              const principal = (req as Request).principal;
              return { tenantId: principal?.tenantId, identityId: principal?.identityId };
            },
            autoLogging: {
              ignore: (req) =>
                req.url?.startsWith("/api/health") === true || req.url === "/api/metrics",
            },
          },
        }),
        ThrottlerModule.forRootAsync({
          imports: [InfraModule.forRoot(config)],
          inject: [RedisService],
          useFactory: (redis: RedisService) => ({
            throttlers: [{ name: "default", ttl: 60_000, limit: 300 }],
            ...(redis.client ? { storage: new RedisThrottlerStorage(redis.client) } : {}),
          }),
        }),
      ],
      controllers: [
        AuthController,
        IdentitiesController,
        RolesController,
        AuditController,
        TenantController,
        DashboardController,
        HealthController,
        MetricsController,
        ConnectorsController,
        DirectoryController,
        ServicePrincipalsController,
        OAuthController,
        ScimTokensController,
        ScimController,
      ],
      providers: [
        AuditService,
        AuthorizationService,
        SessionService,
        OidcService,
        ProvisioningService,
        IdentitiesService,
        RolesService,
        DashboardService,
        HealthService,
        JobQueue,
        ConnectorsService,
        DirectoryService,
        ServicePrincipalsService,
        { provide: BearerResolver, useExisting: ServicePrincipalsService },
        RoleCatalogSync,
        IdentityProviderService,
        ScimTokensService,
        ScimUsersService,
        ScimAuthGuard,
        // Order matters: rate limiting first, then authentication/CSRF/authorization.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: SecurityGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes("*path");
  }
}
