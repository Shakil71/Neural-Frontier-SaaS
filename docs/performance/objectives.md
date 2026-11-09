# Performance objectives and load-test plan

> **No capacity claims are made.** The numbers below are _targets_. Nothing has been load-tested yet;
> results will be recorded here with hardware, data volume and test scripts when measured.

## Service-level objectives (targets)

| Area                               | Objective (target)                                                 | Measured |
| ---------------------------------- | ------------------------------------------------------------------ | -------- |
| Interactive pages (Admin Center)   | p75 LCP < 2.0 s, INP < 200 ms on a mid-range laptop                | not yet  |
| API reads (lists, details)         | p95 < 150 ms at 200 req/s per instance                             | not yet  |
| API writes (role grant, suspend)   | p95 < 250 ms                                                       | not yet  |
| Sign-in round-trip (excluding IdP) | p95 < 400 ms                                                       | not yet  |
| Directory sync (Phase 2)           | 100 k identities initial < 10 min; delta < 60 s                    | not yet  |
| Search (Phase 6)                   | p95 < 300 ms over 2 M identities                                   | not yet  |
| Connector throughput (Phase 3)     | 5 k connected agents per gateway instance                          | not yet  |
| Audit ingestion                    | 1 k events/s sustained per instance without request latency impact | not yet  |
| AI execution concurrency (Phase 4) | 100 concurrent investigations per tenant with queueing             | not yet  |

## Load-test scenarios (to implement with k6 in Phase 2)

1. **Admin browsing**: 500 virtual admins, think time 5 s, mix of overview/list/detail/audit.
2. **Write burst**: 50 admins granting/revoking roles concurrently on the same tenant (contention on owner
   invariant and idempotency keys).
3. **Sign-in storm**: 1 000 sign-ins/min through a stub IdP (session table insert rate, throttling).
4. **Tenant scale**: 1 000 tenants × 2 000 identities (2 M rows), verify tenant-scoped query plans
   use `(tenantId, …)` indexes (`EXPLAIN ANALYZE` captured in the report).
5. **Soak**: 8 h at 60 % of target load; memory and connection-pool stability.

Each report records: commit, hardware, dataset generator seed, k6 script, p50/p95/p99, error rate,
DB CPU/IO, and the bottleneck found.
