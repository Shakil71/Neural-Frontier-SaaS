# Data model

Source of truth: [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma).
Migrations: [`packages/db/prisma/migrations`](../../packages/db/prisma/migrations).

## Conventions

| Rule                                                                  | Why                                                                                                                                          |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| UUIDv7 primary keys (`CHAR(36)`)                                      | Time-ordered → B-tree friendly and usable as a stable cursor; globally unique → safe for future sharding/partitioning and cross-region merge |
| `tenantId` on every tenant-owned table, leading every secondary index | Tenant-scoped queries never scan other tenants' rows                                                                                         |
| Composite `(tenantId, id)` foreign keys for cross-entity links        | The database itself refuses cross-tenant links                                                                                               |
| `version INT` on mutable aggregates                                   | Optimistic concurrency (`409 conflict` on stale writes)                                                                                      |
| `DATETIME(3)` in UTC                                                  | Millisecond ordering for audit; one time zone                                                                                                |
| No credentials stored                                                 | Sign-in is OIDC; session tokens are stored only as SHA-256 hashes                                                                            |
| Expand-only migrations                                                | The previous release must run on the new schema so rollback needs no down-migration ([ADR-0006](../adr/0006-deployment.md))                  |

## Phase 1 entities

| Table              | Purpose                                                               | Notable constraints                                                       |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `tenants`          | Customer organisation                                                 | `slug` unique                                                             |
| `tenant_domains`   | Email domains that route sign-ins to a tenant                         | `domain` unique (one tenant per domain), `verifiedAt` required to sign in |
| `identities`       | People who can sign in                                                | unique `(tenantId, email)`, unique `(oidcIssuer, oidcSubject)`            |
| `roles`            | Built-in (and later custom) roles; `permissions` JSON of catalog keys | unique `(tenantId, key)`                                                  |
| `role_assignments` | Identity ↔ role, with grantor and reason                              | unique `(identityId, roleId)`; composite tenant FKs                       |
| `sessions`         | Server-side sessions                                                  | `tokenHash` unique, idle + absolute expiry, `revokedAt`                   |
| `audit_events`     | Append-only audit trail                                               | runtime DB user has `SELECT, INSERT` only                                 |
| `idempotency_keys` | Replay protection for POSTs                                           | unique `(tenantId, key)`, 24 h expiry                                     |

## Planned entities (not in the schema yet)

Directory connections and objects, groups, assets, servers, endpoints, network devices, firewalls, VPNs,
cloud resources, licenses, AI agents/sessions/executions, workflows, approvals, notifications,
subscriptions, compliance controls, evidence records. Each is introduced with the phase that uses it
([backlog](../backlog.md)); adding unused tables now would create migrations nobody exercises.

High-volume data (telemetry, raw logs, search indexes, large files) will not live in MySQL. The plan
is a time-series/columnar store for telemetry, OpenSearch for search, and S3-compatible object storage —
each chosen when its phase begins, against measured volumes.

## Scale notes (design, not measured)

- 2 M identities × ~1 KB per row ≈ 2 GB plus indexes: comfortably single-node MySQL. Directory sync
  throughput, not storage, will be the constraint; it will be load-tested in Phase 2.
- `audit_events` is the fastest-growing table. Its indexes lead with `(tenantId, occurredAt)` so it can
  be range-partitioned by month without changing queries; retention/export moves to object storage in Phase 8.
