import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ActiveJobExists,
  type ClaimedJob,
  JobQueue,
  PermanentJobError,
} from "../src/modules/jobs/job-queue.js";
import { type JobHandler, JobWorker } from "../src/modules/jobs/job-worker.js";
import { type Fixture, seedTenant, startApp, type TestApp } from "./helpers.js";

let t: TestApp;
let queue: JobQueue;
let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  t = await startApp({ NF_WORKER_TENANT_CONCURRENCY: "1", NF_JOB_LEASE_SECONDS: "5" });
  queue = t.app.get(JobQueue);
  a = await seedTenant(t, "jobs-a");
  b = await seedTenant(t, "jobs-b");
});
afterAll(() => t?.close());

// Other test files share this database: start each test from an empty queue.
beforeEach(async () => {
  await t.database.system.job.deleteMany({});
});

function handler(type: string, impl: (job: ClaimedJob) => Promise<void>) {
  const seen = { runs: 0, retries: 0, dead: [] as string[] };
  const h: JobHandler = {
    type,
    run: async ({ job }) => {
      seen.runs++;
      await impl(job);
    },
    onRetry: async () => {
      seen.retries++;
    },
    onDead: async (job, error) => {
      seen.dead.push(`${job.id}:${error}`);
    },
  };
  return { h, seen };
}

const workerWith = (...handlers: JobHandler[]) => new JobWorker(t.config, queue, handlers, []);
const job = (id: string) => t.database.system.job.findUniqueOrThrow({ where: { id } });
const makeRunnable = (id: string) =>
  t.database.system.job.update({ where: { id }, data: { runAt: new Date(Date.now() - 1000) } });

describe("job queue", () => {
  it("allows only one queued/running job per activeKey", async () => {
    await queue.enqueue({ tenantId: a.tenantId, type: "t", payload: {}, activeKey: "k1" });
    await expect(
      queue.enqueue({ tenantId: a.tenantId, type: "t", payload: {}, activeKey: "k1" }),
    ).rejects.toBeInstanceOf(ActiveJobExists);
  });

  it("retries a failed job with backoff, then succeeds", async () => {
    let calls = 0;
    const { h, seen } = handler("flaky", async () => {
      if (++calls === 1) throw new Error("transient outage");
    });
    const w = workerWith(h);
    const id = await queue.enqueue({ tenantId: a.tenantId, type: "flaky", payload: {} });

    await w.drain();
    let row = await job(id);
    expect(row).toMatchObject({ status: "queued", attempts: 1, lastError: "transient outage" });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now()); // backoff: not runnable yet
    expect(await w.drain()).toBe(0);

    await makeRunnable(id);
    await w.drain();
    row = await job(id);
    expect(row).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(seen).toMatchObject({ runs: 2, retries: 1, dead: [] });
  });

  it("dead-letters after maxAttempts and releases the activeKey", async () => {
    const { h, seen } = handler("doomed", async () => {
      throw new Error("still broken");
    });
    const w = workerWith(h);
    const id = await queue.enqueue({
      tenantId: a.tenantId,
      type: "doomed",
      payload: {},
      maxAttempts: 2,
      activeKey: "doomed-key",
    });
    await w.drain();
    await makeRunnable(id);
    await w.drain();
    expect(await job(id)).toMatchObject({ status: "dead", attempts: 2, activeKey: null });
    expect(seen.dead).toEqual([`${id}:still broken`]);
    // The key is free again.
    await queue.enqueue({
      tenantId: a.tenantId,
      type: "doomed",
      payload: {},
      activeKey: "doomed-key",
    });
  });

  it("dead-letters a permanent error without retrying", async () => {
    const { h, seen } = handler("perm", async () => {
      throw new PermanentJobError("bad credentials");
    });
    const id = await queue.enqueue({ tenantId: a.tenantId, type: "perm", payload: {} });
    await workerWith(h).drain();
    expect(await job(id)).toMatchObject({ status: "dead", attempts: 1 });
    expect(seen.retries).toBe(0);
  });

  it("chaos: a job held by a crashed worker is re-run by another worker (no job lost)", async () => {
    const { h, seen } = handler("chaos", async () => undefined);
    const id = await queue.enqueue({ tenantId: a.tenantId, type: "chaos", payload: {} });

    // Worker A claims the job and dies without completing or renewing its lease.
    const claimed = await queue.claim("worker-a-crashed");
    expect(claimed?.id).toBe(id);
    expect(await queue.claim("worker-b")).toBeNull(); // still leased to A

    // Lease expires (5 s in this test config; fast-forward it).
    await t.database.system.job.update({
      where: { id },
      data: { lockedUntil: new Date(Date.now() - 1) },
    });
    expect(await queue.reapExpired()).toEqual([]); // attempts left: re-queued, not dead

    await workerWith(h).drain();
    expect(await job(id)).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(seen.runs).toBe(1);
    // A's late completion can't overwrite B's result.
    await queue.complete(id, "worker-a-crashed");
    expect((await job(id)).status).toBe("succeeded");
  });

  it("per-tenant fairness: a busy tenant can't take every worker slot", async () => {
    const a1 = await queue.enqueue({ tenantId: a.tenantId, type: "t", payload: {} });
    await queue.enqueue({ tenantId: a.tenantId, type: "t", payload: {} });
    const b1 = await queue.enqueue({ tenantId: b.tenantId, type: "t", payload: {} });

    expect((await queue.claim("w1"))?.id).toBe(a1);
    // Tenant A is at its cap of 1 running job, so B goes next even though A queued first.
    expect((await queue.claim("w2"))?.id).toBe(b1);
    expect(await queue.claim("w3")).toBeNull();
  });

  it("graceful shutdown hands a running job back without counting the attempt", async () => {
    const id = await queue.enqueue({ tenantId: a.tenantId, type: "t", payload: {} });
    await queue.claim("w-stopping");
    await queue.release(id, "w-stopping");
    expect(await job(id)).toMatchObject({ status: "queued", attempts: 0, lockedBy: null });
  });
});
