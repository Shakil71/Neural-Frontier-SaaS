# ADR-0008: Background jobs on a MySQL-backed queue (not BullMQ, for now)

- Status: Accepted · 2026-11-10
- Supersedes: the "BullMQ" line in the Phase 2 backlog

## Context

Phase 2 needs background work: directory syncs (minutes long, retried on throttling or outages),
scheduled per connector, isolated per tenant. The backlog proposed BullMQ on Redis.

What happens on this host:

- Redis is shared with other applications. Neural Frontier's Redis user is restricted by ACL to
  `nf:*` keys and excludes `@dangerous` commands. BullMQ also needs streams, `INFO` and
  `CLIENT SETNAME`. Widening the ACL weakens isolation on a shared host.
- A sync job is created in the same business transaction that records the SyncRun and the audit
  event. With Redis, that is two systems and no shared transaction: a crash between them leaves a
  phantom job or a run that never starts.
- Redis on this host is a cache. It has no backup or restore test. MySQL is backed up daily and its
  restore is tested weekly.
- Expected volume is low: tens to thousands of jobs a day, not thousands a second.

## Decision

Use a `jobs` table in the existing MySQL database:

- **Enqueue in the caller's transaction.** The job exists if and only if the business change
  committed.
- **Claim with `SELECT … FOR UPDATE SKIP LOCKED`.** Each claim takes a lease (`lockedUntil`, default
  120 s), and a heartbeat renews it every third of the lease. If a worker crashes, its lease
  expires and the reaper re-queues the job. This is covered by a chaos test.
- **Retries** use exponential backoff with jitter: 15 s, 30 s, 60 s …, capped at 15 min.
  `PermanentJobError` skips retries.
- **Dead letter.** After `maxAttempts` a job becomes `dead`. It keeps its last error and the
  handler's `onDead` records the failure (for example, sync run failed plus an audit event). Dead
  jobs are kept for 90 days and succeeded jobs for 14.
- **Per-tenant fairness.** A tenant never has more than `NF_WORKER_TENANT_CONCURRENCY` jobs
  running, so one tenant can't take every worker slot.
- **Uniqueness.** `activeKey` is unique while a job is queued or running; it is how "one sync per
  connector" is enforced.
- **Separate process.** The worker runs as its own process (`dist/worker.js`,
  `neural-frontier-worker.service`) with the same hardening as the API. On SIGTERM it hands
  running jobs back to the queue without counting the attempt.

## Consequences

- No new infrastructure. No Redis ACL changes. Jobs are covered by existing backups.
- Throughput is bounded by MySQL row locking, which is far above current needs. Polling (default
  2 s when idle) adds a small, constant query load.
- Revisit when sustained load exceeds a few hundred jobs a second, or when sub-second latency is
  needed. The `JobQueue` interface (enqueue, claim, heartbeat, complete, fail) is small enough to
  re-implement on BullMQ or a stream without changing handlers.
