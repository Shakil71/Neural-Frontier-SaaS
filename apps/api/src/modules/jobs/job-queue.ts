import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type ScopedTransaction } from "@nf/db";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { DatabaseService } from "../../infra/database.service.js";

export interface EnqueueInput {
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  /** While a job with this key is queued or running, enqueueing another one fails. */
  activeKey?: string;
  maxAttempts?: number;
  runAt?: Date;
}

export interface ClaimedJob {
  id: string;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export class ActiveJobExists extends Error {
  constructor(readonly activeKey: string) {
    super(`A job with key ${activeKey} is already queued or running`);
  }
}

/** Thrown by a handler for failures that retrying cannot fix (bad credentials, deleted connector). */
export class PermanentJobError extends Error {
  override name = "PermanentJobError";
}

/** Retry delay after the n-th failed attempt: 15 s, 30 s, 60 s … capped at 15 min, ±20 % jitter. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(15_000 * 2 ** Math.max(0, attempt - 1), 15 * 60_000);
  return Math.round(base * (0.8 + random() * 0.4));
}

type Writer = Pick<ScopedTransaction, "job">;

/**
 * Durable job queue on MySQL (ADR 0008).
 * - Enqueue is transactional with the business change that needs it (no lost or phantom jobs).
 * - Workers claim with SELECT … FOR UPDATE SKIP LOCKED and hold a lease they renew while
 *   working. If a worker dies, its lease expires and the job is retried by another worker.
 * - Per-tenant fairness: a tenant never has more than `tenantConcurrency` jobs running.
 * - Failures retry with exponential backoff; after `maxAttempts` the job is `dead`
 *   (the dead-letter state), kept for inspection with its last error.
 */
@Injectable()
export class JobQueue {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
  ) {}

  async enqueue(input: EnqueueInput, tx?: Writer): Promise<string> {
    const writer: Writer = tx ?? this.database.db;
    try {
      const job = await writer.job.create({
        data: {
          tenantId: input.tenantId,
          type: input.type,
          payload: input.payload as Prisma.InputJsonValue,
          activeKey: input.activeKey ?? null,
          maxAttempts: input.maxAttempts ?? 5,
          runAt: input.runAt ?? new Date(),
        },
      });
      return job.id;
    } catch (err) {
      if (
        input.activeKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ActiveJobExists(input.activeKey);
      }
      throw err;
    }
  }

  /** Claims the next runnable job for this worker, or returns null. */
  async claim(workerId: string): Promise<ClaimedJob | null> {
    const now = new Date();
    const cap = this.config.worker.tenantConcurrency;
    // Cross-tenant by definition: the worker serves every tenant.
    return this.database.system.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT j.id FROM jobs j
        WHERE j.status = 'queued' AND j.runAt <= ${now}
          AND j.tenantId NOT IN (
            SELECT busy.tenantId FROM (
              SELECT tenantId FROM jobs
              WHERE status = 'running' AND lockedUntil > ${now}
              GROUP BY tenantId HAVING COUNT(*) >= ${cap}
            ) AS busy
          )
        ORDER BY j.runAt, j.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      const id = rows[0]?.id;
      if (!id) return null;
      const job = await tx.job.update({
        where: { id },
        data: {
          status: "running",
          attempts: { increment: 1 },
          lockedBy: workerId,
          lockedUntil: new Date(now.getTime() + this.config.worker.leaseMs),
        },
      });
      return {
        id: job.id,
        tenantId: job.tenantId,
        type: job.type,
        payload: (job.payload ?? {}) as Record<string, unknown>,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      };
    });
  }

  /** Extends the lease. Returns false if this worker no longer owns the job. */
  async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const res = await this.database.system.job.updateMany({
      where: { id: jobId, lockedBy: workerId, status: "running" },
      data: { lockedUntil: new Date(Date.now() + this.config.worker.leaseMs) },
    });
    return res.count === 1;
  }

  async complete(jobId: string, workerId: string): Promise<void> {
    await this.database.system.job.updateMany({
      where: { id: jobId, lockedBy: workerId, status: "running" },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        activeKey: null,
        lockedBy: null,
        lockedUntil: null,
      },
    });
  }

  /**
   * Records a failure. Returns "retry" (re-queued with backoff) or "dead". A dead job keeps its
   * last error and releases its activeKey so the work can be requested again.
   */
  async fail(
    job: ClaimedJob,
    workerId: string,
    error: string,
    permanent: boolean,
  ): Promise<"retry" | "dead" | "lost"> {
    const dead = permanent || job.attempts >= job.maxAttempts;
    const res = await this.database.system.job.updateMany({
      where: { id: job.id, lockedBy: workerId, status: "running" },
      data: dead
        ? {
            status: "dead",
            lastError: error.slice(0, 2000),
            finishedAt: new Date(),
            activeKey: null,
            lockedBy: null,
            lockedUntil: null,
          }
        : {
            status: "queued",
            lastError: error.slice(0, 2000),
            runAt: new Date(Date.now() + backoffMs(job.attempts)),
            lockedBy: null,
            lockedUntil: null,
          },
    });
    if (res.count === 0) return "lost";
    return dead ? "dead" : "retry";
  }

  /** Graceful shutdown: hand the job back without counting the attempt. */
  async release(jobId: string, workerId: string): Promise<void> {
    await this.database.system.job.updateMany({
      where: { id: jobId, lockedBy: workerId, status: "running" },
      data: {
        status: "queued",
        attempts: { decrement: 1 },
        runAt: new Date(),
        lockedBy: null,
        lockedUntil: null,
      },
    });
  }

  /**
   * Re-queues jobs whose worker stopped renewing its lease (crash, kill -9, host reboot).
   * Returns the jobs that ran out of attempts, so their handlers can record the failure.
   */
  async reapExpired(): Promise<ClaimedJob[]> {
    const now = new Date();
    const expired = await this.database.system.job.findMany({
      where: { status: "running", lockedUntil: { lt: now } },
      take: 100,
    });
    const dead: ClaimedJob[] = [];
    for (const j of expired) {
      const exhausted = j.attempts >= j.maxAttempts;
      const res = await this.database.system.job.updateMany({
        where: { id: j.id, status: "running", lockedUntil: j.lockedUntil },
        data: exhausted
          ? {
              status: "dead",
              lastError: "Worker stopped while running the job (lease expired)",
              finishedAt: now,
              activeKey: null,
              lockedBy: null,
              lockedUntil: null,
            }
          : {
              status: "queued",
              lastError: "Worker stopped while running the job (lease expired); retrying",
              runAt: now,
              lockedBy: null,
              lockedUntil: null,
            },
      });
      if (res.count === 1 && exhausted) {
        dead.push({
          id: j.id,
          tenantId: j.tenantId,
          type: j.type,
          payload: (j.payload ?? {}) as Record<string, unknown>,
          attempts: j.attempts,
          maxAttempts: j.maxAttempts,
        });
      }
    }
    return dead;
  }

  /** Housekeeping: finished jobs are kept for 14 days, dead ones for 90. */
  async prune(): Promise<number> {
    const day = 86_400_000;
    const res = await this.database.system.job.deleteMany({
      where: {
        OR: [
          { status: "succeeded", finishedAt: { lt: new Date(Date.now() - 14 * day) } },
          { status: "dead", finishedAt: { lt: new Date(Date.now() - 90 * day) } },
        ],
      },
    });
    return res.count;
  }
}
