# ADR-0004: Tenant isolation — shared schema, three enforcement layers

- Status: Accepted · 2026-11-09

## Options considered

| Model                                | Isolation              | Cost at 1,000s of tenants         | Fit                                |
| ------------------------------------ | ---------------------- | --------------------------------- | ---------------------------------- |
| Database per tenant                  | Strongest              | High (connections, migrations ×N) | Dedicated / private-cloud editions |
| Schema per tenant                    | Strong                 | High in MySQL (schema = database) | —                                  |
| **Shared schema, `tenantId` column** | Depends on enforcement | Low                               | Multi-tenant SaaS — chosen         |

## Decision

Shared schema with three independent layers (see [architecture overview](../architecture/overview.md)):
tenant from the session only; a Prisma extension that refuses unscoped queries; composite foreign keys
that make cross-tenant rows unrepresentable. Cross-tenant reads are confined to a named `system` client
used in exactly two places (session-token lookup, email-domain → tenant mapping).

## Consequences

- Dedicated deployments (Phase 9) run the same code with one tenant per database.
- Regional data residency (Phase 10) places tenants in regional database clusters; UUIDv7 keys merge safely.
- Future: per-tenant encryption keys for sensitive fields (envelope encryption via KMS) — Phase 8.
