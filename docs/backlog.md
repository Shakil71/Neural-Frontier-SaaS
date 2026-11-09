# Prioritised engineering backlog

Each phase ends at a gate: its acceptance criteria are met, CI is green, the threat model and the
feature catalog are updated, and a phase report is written. Priorities: **P0** blocks the phase,
**P1** expected in the phase, **P2** may slip to the next phase.

## Phase 1 — Foundation (this delivery)

| Pri | Item                                                                   | Acceptance criteria                                                             | Status                          |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| P0  | Monorepo, contracts, strict TS, lint/format                            | `npm run lint`, `typecheck`, `format:check` clean                               | Done                            |
| P0  | Schema + migrations, tenant isolation                                  | Integration tests prove guard + composite FKs + per-endpoint isolation          | Done (CI)                       |
| P0  | OIDC sign-in, sessions, CSRF                                           | E2E signs in through a real OIDC provider; unit tests for tokens/state          | Done (CI)                       |
| P0  | RBAC + audit                                                           | Denials audited; separation of duties unit-tested; audit in same transaction    | Done (CI)                       |
| P0  | Admin Center: overview, identities, roles, audit, health, organisation | Real API data only; loading/empty/error/forbidden states; keyboard accessible   | Done                            |
| P0  | CI: quality, integration, E2E, supply chain, CodeQL                    | All jobs green on `phase-1-foundation`                                          | See phase report                |
| P0  | Oracle Linux deployment kit                                            | Scripts pass shellcheck; runbook complete; **not executed** (awaiting approval) | Done (prepared)                 |
| P1  | First production rollout                                               | install.sh + Deploy workflow + validate.sh all green on the VPS                 | Done (2026-11-09, Keycloak IdP) |

## Phase 2 — Identity connectors (in progress)

Phase 2 is delivered in slices. **2a** (this delivery) is the connector platform and the Entra ID
connector; **2b** covers the items that need external systems to test against.

| Pri | Item                                                         | Acceptance criteria                                         | Status                                                                                    |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P0  | Production IdP                                               | Sign-in works on the VPS                                    | Done: self-hosted Keycloak                                                                |
| P0  | Per-tenant IdP settings                                      | Sign-in works for two tenants with different IdPs           | 2b: built (ADR 0009); E2E signs in through two different IdPs                             |
| P0  | Machine identity: OAuth client credentials                   | Scoped tokens, rotation, audit                              | 2a: built, integration-tested                                                             |
| P0  | Microsoft Graph connector: Entra users/groups read-only sync | Delta sync; idempotent; 100 k users < 10 min in a load test | 2a: delta/idempotent sync tested against a Graph wire-format mock. **Load test not run.** |
| P0  | Job system with retries, dead-letter, per-tenant fairness    | Chaos test: worker restart loses no jobs                    | 2a: on MySQL (ADR 0008); chaos and fairness tests                                         |
| P0  | Windows AD connector (.NET 10 LTS service)                   | Multi-domain inventory over mTLS; signed releases           | 2b: needs a Windows domain to test against                                                |
| P1  | SAML 2.0, SCIM 2.0 inbound provisioning                      | Conformance test suites pass                                | 2c: SCIM 2.0 Users built (Groups, SAML pending); external conformance suite not run       |
| P1  | Linux agent (Go) inventory MVP                               | RHEL/OL/Ubuntu/Debian/Rocky/Alma                            | 2b                                                                                        |
| P1  | ESLint import-boundary rules between modules                 | CI fails on cross-domain imports                            | 2b: built (contracts, db, web features, api modules)                                      |
| P2  | OpenTelemetry traces to the host's Prometheus/Grafana stack  | Trace a request end to end                                  | 2b                                                                                        |

## Phase 3 – 10 (outline; detailed at each phase gate)

3 Infrastructure, network, VPN, firewall, cloud inventory · 4 AI gateway and read-only agents with
evidence · 5 Approval-based automation, JIT access · 6 Drive, Workspace, Projects, Forms · 7 Mail,
Connect, Docs · 8 DLP, retention, Trust & Compliance Center, hash-chained audit export · 9 Billing,
onboarding, private-cloud edition · 10 HA, DR, multi-region.

## Technical debt register

| Item                                                 | Reason accepted                     | Pay down by                            |
| ---------------------------------------------------- | ----------------------------------- | -------------------------------------- |
| Design system lives in `apps/web`                    | Single consumer                     | Phase 6 (second app)                   |
| In-memory throttling when Redis is absent (dev only) | Production config requires Redis    | —                                      |
| Self-signed certificate                              | No domain yet                       | When a domain is chosen                |
| Node 22 (not 24) on host                             | Host Node is shared with other apps | Dedicated host or per-app Node runtime |
