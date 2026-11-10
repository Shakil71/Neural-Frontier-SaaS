import { type DynamicModule, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import type { AppConfig } from "./config/config.js";
import { InfraModule } from "./infra/infra.module.js";
import { AuditService } from "./modules/audit/audit.service.js";
import { OidcService } from "./modules/auth/oidc.service.js";
import { SessionService } from "./modules/auth/session.service.js";
import { AuthorizationService } from "./modules/authz/authorization.service.js";
import { LocalAuthService } from "./modules/local-auth/local-auth.service.js";
import { EmailService } from "./modules/email/email.service.js";
import { JobQueue } from "./modules/jobs/job-queue.js";

/** Operator commands (dist/cli.js): no HTTP, only what the commands need. */
@Module({})
export class CliModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CliModule,
      imports: [InfraModule.forRoot(config), LoggerModule.forRoot({ pinoHttp: { level: "warn" } })],
      providers: [
        AuditService,
        AuthorizationService,
        SessionService,
        OidcService,
        JobQueue,
        EmailService,
        LocalAuthService,
      ],
    };
  }
}
