# Neural Frontier

**One Intelligent Platform. Infinite Possibilities.**

An AI-native enterprise platform for identity, infrastructure, security and digital-workplace operations.
This repository is at **Phase 1 (foundation)**: multi-tenant identity and access administration with an
original Admin Center. Everything else in the long-term vision is planned, not built — see the
[feature catalog](docs/product/feature-catalog.md) for exact status.

## What works today

- Sign-in through any OpenID Connect identity provider (PKCE), server-side sessions
- Multi-tenant isolation enforced in code, in the data-access layer and by database constraints
- Role-based access control with separation of duties and an append-only audit trail
- Admin Center: live overview dashboard, identities (suspend/reactivate, grant/revoke roles), roles &
  permission matrix, audit log, system health, organisation settings — dark and light themes, ⌘K palette
- Health checks, Prometheus metrics, structured logs, OpenAPI
- CI: lint, types, unit/integration/E2E tests, CodeQL, dependency/secret/license scanning, SBOM
- Oracle Linux 9 deployment kit (systemd, Nginx, SELinux, encrypted backups with restore tests)

## Stack

Next.js 16 · React 19 · Tailwind 4 · Radix · TanStack · ECharts — NestJS 12 · Prisma 7 · MySQL 8.4 ·
Redis 7 — TypeScript 6 strict. Rationale in [ADR-0001](docs/adr/0001-technology-baseline.md).

## Repository

```
apps/web            Admin Center (Next.js)
apps/api            Control-plane API (NestJS)
packages/contracts  Shared API contracts and permission catalog
packages/db         Prisma schema, migrations, tenant guard
tools/dev-idp       Development-only OIDC provider
deploy/oracle-linux Production deployment kit
docs/               Architecture, ADRs, security, compliance, operations
```

## Documentation

- [Developer guide](docs/development.md) · [Architecture](docs/architecture/overview.md) ·
  [Data model](docs/architecture/data-model.md) · [ADRs](docs/adr)
- [Feature catalog](docs/product/feature-catalog.md) · [Microsoft 365 comparison](docs/product/m365-comparison.md) ·
  [Build vs integrate](docs/product/build-vs-integrate.md) · [Backlog](docs/backlog.md)
- [Threat model](docs/security/threat-model.md) · [ISO readiness](docs/compliance/iso-readiness.md) ·
  [License register](docs/compliance/license-register.md) · [Performance objectives](docs/performance/objectives.md)
- [Design system](docs/design/design-system.md) · [Deployment runbook](docs/operations/deployment.md)

Neural Frontier is not certified against ISO/IEC 27001 or any other standard, and makes no capacity
claims until they are measured.
