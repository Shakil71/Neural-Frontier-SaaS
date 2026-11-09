import { hostname } from "node:os";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { type ClaimedJob, JobQueue, PermanentJobError } from "./job-queue.js";

export interface JobContext {
  job: ClaimedJob;
  /** Aborted when the lease is lost or the worker shuts down; handlers should stop promptly. */
  signal: AbortSignal;
}

export interface JobHandler {
  readonly type: string;
  run(ctx: JobContext): Promise<void>;
  /** Called after a failed attempt that will be retried. */
  onRetry?(job: ClaimedJob, error: string): Promise<void>;
  /** Called once when the job is dead-lettered (attempts exhausted or a permanent error). */
  onDead?(job: ClaimedJob, error: string): Promise<void>;
}

export const JOB_HANDLERS = Symbol("JOB_HANDLERS");

/** Runs scheduled work alongside jobs, e.g. enqueueing due connector syncs. */
export interface PeriodicTask {
  readonly name: string;
  readonly intervalMs: number;
  tick(): Promise<void>;
}
export const PERIODIC_TASKS = Symbol("PERIODIC_TASKS");

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Job worker: a fixed number of slots, each claiming and running one job at a time.
 * Runs in its own process (dist/worker.js, systemd neural-frontier-worker.service).
 */
@Injectable()
export class JobWorker {
  private readonly logger = new Logger(JobWorker.name);
  readonly id = `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  private readonly handlers: Map<string, JobHandler>;
  private running = false;
  private readonly active = new Map<string, AbortController>();
  private loops: Promise<void>[] = [];
  private timers: NodeJS.Timeout[] = [];
  private readonly wakers = new Set<() => void>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queue: JobQueue,
    @Inject(JOB_HANDLERS) handlers: JobHandler[],
    @Inject(PERIODIC_TASKS) private readonly periodic: PeriodicTask[],
  ) {
    this.handlers = new Map(handlers.map((h) => [h.type, h]));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.log(
      {
        workerId: this.id,
        slots: this.config.worker.concurrency,
        types: [...this.handlers.keys()],
      },
      "job worker started",
    );
    for (let i = 0; i < this.config.worker.concurrency; i++) this.loops.push(this.loop());
    const housekeeping: PeriodicTask = {
      name: "jobs.housekeeping",
      intervalMs: 30_000,
      tick: async () => {
        for (const job of await this.queue.reapExpired()) {
          await this.deadLetter(job, "Worker stopped while running the job (lease expired)");
        }
      },
    };
    for (const task of [housekeeping, ...this.periodic]) {
      const run = () =>
        void task
          .tick()
          .catch((err: unknown) =>
            this.logger.error({ err: message(err), task: task.name }, "periodic task failed"),
          );
      run();
      this.timers.push(setInterval(run, task.intervalMs));
    }
    this.timers.push(
      setInterval(() => void this.queue.prune().catch(() => undefined), 6 * 3_600_000),
    );
  }

  /** Stops claiming, aborts running jobs and hands them back to the queue. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const w of this.wakers) w();
    for (const c of this.active.values()) c.abort(new Error("worker shutting down"));
    await Promise.allSettled(this.loops);
    this.loops = [];
    this.logger.log({ workerId: this.id }, "job worker stopped");
  }

  /** Test hook: claim and run jobs until none is runnable. */
  async drain(): Promise<number> {
    let n = 0;
    for (;;) {
      const job = await this.queue.claim(this.id);
      if (!job) return n;
      await this.execute(job);
      n++;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.wakers.delete(done);
        resolve();
      };
      const t = setTimeout(done, ms);
      this.wakers.add(done);
    });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let job: ClaimedJob | null = null;
      try {
        job = await this.queue.claim(this.id);
      } catch (err) {
        this.logger.warn({ err: message(err) }, "claim failed; backing off");
      }
      if (!job) {
        await this.sleep(this.config.worker.pollMs);
        continue;
      }
      await this.execute(job);
    }
  }

  private async execute(job: ClaimedJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    const controller = new AbortController();
    this.active.set(job.id, controller);
    const beat = setInterval(
      () =>
        void this.queue.heartbeat(job.id, this.id).then(
          (owned) => {
            if (!owned) controller.abort(new Error("lease lost"));
          },
          () => undefined,
        ),
      Math.max(1000, Math.floor(this.config.worker.leaseMs / 3)),
    );
    const started = Date.now();
    try {
      if (!handler) throw new PermanentJobError(`No handler for job type ${job.type}`);
      await handler.run({ job, signal: controller.signal });
      await this.queue.complete(job.id, this.id);
      this.logger.log(
        { jobId: job.id, type: job.type, tenantId: job.tenantId, ms: Date.now() - started },
        "job succeeded",
      );
    } catch (err) {
      if (!this.running && controller.signal.aborted) {
        await this.queue.release(job.id, this.id);
        this.logger.log({ jobId: job.id }, "job handed back for another worker");
        return;
      }
      const error = message(err);
      const outcome = await this.queue.fail(job, this.id, error, err instanceof PermanentJobError);
      this.logger.warn(
        {
          jobId: job.id,
          type: job.type,
          tenantId: job.tenantId,
          attempt: job.attempts,
          outcome,
          err: error,
        },
        "job failed",
      );
      if (outcome === "dead") await this.deadLetter(job, error);
      else if (outcome === "retry") await handler?.onRetry?.(job, error).catch(() => undefined);
    } finally {
      clearInterval(beat);
      this.active.delete(job.id);
    }
  }

  private async deadLetter(job: ClaimedJob, error: string) {
    try {
      await this.handlers.get(job.type)?.onDead?.(job, error);
    } catch (err) {
      this.logger.error({ jobId: job.id, err: message(err) }, "onDead handler failed");
    }
  }
}
