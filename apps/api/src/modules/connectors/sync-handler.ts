import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { type ClaimedJob, PermanentJobError } from "../jobs/job-queue.js";
import type { JobContext, JobHandler, PeriodicTask } from "../jobs/job-worker.js";
import { ConnectorsService, SYNC_JOB } from "./connectors.service.js";
import { DeltaExpiredError, GraphError } from "./graph-client.js";
import { syncGraphDirectory } from "./graph-sync.js";

const SYSTEM_ACTOR = { id: null, label: "system:connector-sync" };

function payloadOf(job: ClaimedJob) {
  const connectorId = job.payload.connectorId;
  const syncRunId = job.payload.syncRunId;
  if (typeof connectorId !== "string" || typeof syncRunId !== "string") {
    throw new PermanentJobError("Malformed sync job payload");
  }
  return { connectorId, syncRunId };
}

/** Runs one directory sync (job type `connector.sync`). */
@Injectable()
export class ConnectorSyncHandler implements JobHandler {
  readonly type = SYNC_JOB;
  private readonly logger = new Logger(ConnectorSyncHandler.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly connectors: ConnectorsService,
    private readonly audit: AuditService,
  ) {}

  async run({ job, signal }: JobContext): Promise<void> {
    const { connectorId, syncRunId } = payloadOf(job);
    const tenantId = job.tenantId;
    const db = this.database.db;

    const connector = await db.connector.findUnique({ where: { id: connectorId, tenantId } });
    if (!connector) throw new PermanentJobError("The connector was deleted");
    if (connector.status !== "active") throw new PermanentJobError("The connector is disabled");

    await db.syncRun.updateMany({
      where: { id: syncRunId, tenantId },
      data: { status: "running", startedAt: new Date(), attempts: job.attempts, error: null },
    });

    let client;
    try {
      client = this.connectors.clientFor(connector);
    } catch (err) {
      throw new PermanentJobError(err instanceof Error ? err.message : "Credential unavailable");
    }

    const syncOnce = (links: { users: string | null; groups: string | null }) =>
      syncGraphDirectory({
        db,
        client,
        tenantId,
        connectorId,
        usersDeltaLink: links.users,
        groupsDeltaLink: links.groups,
        signal,
      });

    let result;
    try {
      try {
        result = await syncOnce({
          users: connector.usersDeltaLink,
          groups: connector.groupsDeltaLink,
        });
      } catch (err) {
        if (!(err instanceof DeltaExpiredError)) throw err;
        this.logger.warn({ connectorId }, "delta token expired; running a full sync");
        result = await syncOnce({ users: null, groups: null });
      }
    } catch (err) {
      if (err instanceof GraphError && !err.transient) throw new PermanentJobError(err.message);
      throw err;
    }

    const finishedAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.syncRun.updateMany({
        where: { id: syncRunId, tenantId },
        data: { status: "succeeded", mode: result.mode, finishedAt, error: null, ...result.counts },
      });
      await tx.connector.updateMany({
        where: { id: connectorId, tenantId },
        data: {
          lastSyncAt: finishedAt,
          lastSyncStatus: "succeeded",
          ...(result.usersDeltaLink ? { usersDeltaLink: result.usersDeltaLink } : {}),
          ...(result.groupsDeltaLink ? { groupsDeltaLink: result.groupsDeltaLink } : {}),
        },
      });
      await this.audit.record(
        {
          tenantId,
          action: "connector.sync_completed",
          outcome: "success",
          actor: SYSTEM_ACTOR,
          target: { type: "connector", id: connectorId, label: connector.name },
          metadata: { syncRunId, mode: result.mode, ...result.counts },
        },
        tx,
      );
    });
  }

  async onRetry(job: ClaimedJob, error: string): Promise<void> {
    const { syncRunId } = payloadOf(job);
    await this.database.db.syncRun.updateMany({
      where: { id: syncRunId, tenantId: job.tenantId },
      data: {
        status: "queued",
        error: `Attempt ${job.attempts} of ${job.maxAttempts} failed: ${error}`.slice(0, 1000),
      },
    });
  }

  async onDead(job: ClaimedJob, error: string): Promise<void> {
    const { connectorId, syncRunId } = payloadOf(job);
    const tenantId = job.tenantId;
    const now = new Date();
    await this.database.db.$transaction(async (tx) => {
      await tx.syncRun.updateMany({
        where: { id: syncRunId, tenantId },
        data: { status: "failed", finishedAt: now, error: error.slice(0, 1000) },
      });
      const connector = await tx.connector.findUnique({ where: { id: connectorId, tenantId } });
      if (!connector) return;
      await tx.connector.update({
        where: { id: connectorId, tenantId },
        // lastSyncAt moves on failure too, so the scheduler waits a full interval to retry.
        data: { lastSyncAt: now, lastSyncStatus: "failed" },
      });
      await this.audit.record(
        {
          tenantId,
          action: "connector.sync_failed",
          outcome: "failure",
          actor: SYSTEM_ACTOR,
          target: { type: "connector", id: connectorId, label: connector.name },
          metadata: { syncRunId, attempts: job.attempts, error: error.slice(0, 500) },
        },
        tx,
      );
    });
  }
}

/** Every minute: queue a sync for each active connector whose interval has elapsed. */
@Injectable()
export class ConnectorScheduler implements PeriodicTask {
  readonly name = "connectors.schedule";
  readonly intervalMs = 60_000;
  private readonly logger = new Logger(ConnectorScheduler.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly connectors: ConnectorsService,
  ) {}

  async tick(): Promise<void> {
    const now = Date.now();
    // Cross-tenant by definition: the scheduler serves every tenant.
    const candidates = await this.database.system.connector.findMany({
      where: { status: "active", syncIntervalMinutes: { gt: 0 } },
      select: { id: true, tenantId: true, lastSyncAt: true, syncIntervalMinutes: true },
    });
    for (const c of candidates) {
      const due = !c.lastSyncAt || c.lastSyncAt.getTime() + c.syncIntervalMinutes * 60_000 <= now;
      if (!due) continue;
      try {
        await this.connectors.requestSync(c.tenantId, c.id, "schedule", SYSTEM_ACTOR);
      } catch (err) {
        // 409 = already queued/running: expected, not an error.
        if (!(err instanceof Error && /already queued or running/.test(err.message))) {
          this.logger.warn({ connectorId: c.id, err: String(err) }, "could not schedule sync");
        }
      }
    }
  }
}
