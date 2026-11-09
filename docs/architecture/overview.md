# Architecture overview

_Status: Phase 1 foundation. Last reviewed 2026-11-09._

Neural Frontier is designed around six architectural planes. Phase 1 builds the parts of the
**Experience**, **Control** and **Data** planes that every later module depends on: identity,
tenancy, authorization, audit, and the Admin Center shell. The other planes are designed but not
built; they appear here so that Phase 1 decisions don't block them.

```
                ┌────────────────────────── Experience plane ──────────────────────────┐
 Browser ──TLS──▶ Nginx :8643 ──▶ Admin Center (Next.js 16, :3400)                      │
                │        │        Employee Workspace · AI Command Center · Security …  (planned)
                │        └─/api─▶┌──────────────── Control plane (NestJS 12, :3401) ────────┐
                │                │ auth (OIDC RP, sessions) · authz (RBAC) · audit           │
                │                │ identities · roles · tenant · dashboard · health/metrics │
                │                │ connectors · workflows · approvals · billing   (planned) │
                │                └──────┬────────────────────────────┬──────────────────────┘
                │                       │                            │
                │      ┌──── Data plane ┴────┐            ┌──────────┴──────────┐
                │      │ MySQL 8.4 (Prisma)  │            │ Redis 7 (nf:* ACL)  │
                │      │ tenant-scoped rows  │            │ rate limits         │
                │      └─────────────────────┘            └─────────────────────┘
                │   Execution plane (Windows/Linux agents, Graph, AD, network) — planned, isolated
                │   AI Intelligence plane (model gateway, agents, evidence)    — planned, no direct execution
                └── Trust & Governance plane: audit trail, threat model, ISO readiness — started
```

## Repository layout

| Path                      | What it is                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/web`                | Admin Center — Next.js App Router, React 19, Tailwind 4, Radix, TanStack Query/Table, ECharts                |
| `apps/api`                | Control-plane API — NestJS modular monolith, OpenAPI, Zod validation                                         |
| `packages/contracts`      | Shared Zod schemas, permission catalog, built-in roles — the API/UI contract                                 |
| `packages/db`             | Prisma schema, SQL migrations, tenant guard, bootstrap seed                                                  |
| `tools/dev-idp`           | Development-only OIDC provider for local sign-in and E2E tests (never deployed)                              |
| `tools/license-check.mjs` | License compliance gate                                                                                      |
| `deploy/oracle-linux`     | systemd units, Nginx site, MySQL/Redis provisioning, install/deploy/rollback/backup/restore/validate scripts |
| `docs`                    | Architecture, ADRs, product catalog, security, compliance, operations                                        |

Folders exist only for things that exist. Planned modules live in
[`docs/product/feature-catalog.md`](../product/feature-catalog.md), not as empty directories.

## Domain boundaries inside the API

Each folder under `apps/api/src/modules` is a domain with its own controller and service. Cross-domain
calls go through services (never another domain's tables directly), so any domain can later be
extracted into its own service. See [ADR-0002](../adr/0002-modular-monolith.md).

| Module              | Owns                                                  | Depends on                                        |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `auth`              | OIDC relying party, sessions, CSRF, provisioning      | audit, authz                                      |
| `authz`             | Permission resolution, `@RequirePermission`           | —                                                 |
| `audit`             | Append-only audit events                              | —                                                 |
| `identities`        | Identity lifecycle (suspend/reactivate)               | audit, auth (session revocation), roles invariant |
| `roles`             | Roles, assignments, last-owner invariant, idempotency | audit                                             |
| `tenant`            | Tenant profile, domains                               | auth (SSO status)                                 |
| `dashboard`         | Read-only aggregates                                  | —                                                 |
| `health`, `metrics` | Liveness/readiness, Prometheus metrics                | infra                                             |

## Request lifecycle

1. **Nginx** terminates TLS, rate-limits `/api/v1/auth/*` and `/api/*`, overwrites `X-Forwarded-For`,
   and refuses `/api/metrics` and `/api/docs`.
2. **Request ID**: an upstream `x-request-id` is accepted only if well-formed; otherwise one is minted.
   It is returned in the response, logged, and stored on audit events.
3. **ThrottlerGuard** (Redis-backed in production) limits per client IP.
4. **SecurityGuard** (global, deny-by-default): session cookie → principal; for non-GET requests,
   same-origin `Origin` and the session-bound CSRF token; then `@RequirePermission`, checked against
   role assignments loaded on that request. Denials are audited.
5. **Controller** parses input with the shared Zod contract (`validation_failed` on error).
6. **Service** runs business rules inside a transaction on the **tenant-guarded** Prisma client; the
   audit event is written in the same transaction.
7. **ApiExceptionFilter** maps every error to the `ApiError` contract, never leaking internals.

## Tenant isolation (three layers)

1. **Application**: every query receives `tenantId` from the authenticated principal, never from input.
2. **Tenant guard** (`packages/db/src/tenant-guard.ts`): a Prisma extension that throws if a query on
   a tenant-owned model omits `tenantId`. Cross-tenant lookups that are unavoidable (resolving a session
   token, mapping an email domain to a tenant at sign-in) use the explicitly named `system` client.
3. **Database**: composite `(tenantId, id)` foreign keys make it impossible to store a role assignment
   or session that joins rows of two tenants.

Integration tests prove each layer (`apps/api/test/security.int.test.ts`).

## What is deliberately not built yet

Execution plane, AI plane, connectors, workflows/approvals, billing, search, object storage, OpenTelemetry
tracing export, BullMQ workers, Kafka/NATS, Kubernetes. Each has a phase in
[`docs/backlog.md`](../backlog.md). Adding them before they are needed would add operational risk
without customer value (directive §1.5).
