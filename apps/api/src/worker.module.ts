import { type DynamicModule, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import type { AppConfig } from "./config/config.js";
import { InfraModule } from "./infra/infra.module.js";
import { AuditService } from "./modules/audit/audit.service.js";
import { ConnectorsService } from "./modules/connectors/connectors.service.js";
import { ConnectorScheduler, ConnectorSyncHandler } from "./modules/connectors/sync-handler.js";
import { JobQueue } from "./modules/jobs/job-queue.js";
import { JOB_HANDLERS, JobWorker, PERIODIC_TASKS } from "./modules/jobs/job-worker.js";

/** The background worker process: no HTTP, just the job queue and its handlers. */
@Module({})
export class WorkerModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        InfraModule.forRoot(config),
        LoggerModule.forRoot({ pinoHttp: { level: config.logLevel } }),
      ],
      providers: [
        AuditService,
        JobQueue,
        ConnectorsService,
        ConnectorSyncHandler,
        ConnectorScheduler,
        {
          provide: JOB_HANDLERS,
          inject: [ConnectorSyncHandler],
          useFactory: (sync: ConnectorSyncHandler) => [sync],
        },
        {
          provide: PERIODIC_TASKS,
          inject: [ConnectorScheduler],
          useFactory: (schedule: ConnectorScheduler) => [schedule],
        },
        JobWorker,
      ],
    };
  }
}
