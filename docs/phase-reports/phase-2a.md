# Phase 2a report: connector platform and Microsoft Entra ID

_Branch `phase-2a-connectors`, merged to `main` (94faeb6) · 2026-11-09_

## What was built

| Area                         | Delivered                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft Entra ID connector | Read-only sync of users, groups and memberships over Graph delta queries. Covers paging, `@removed`, partial delta updates, 429 with Retry-After, and an expired delta token (falls back to a full sync). Paging links are restricted to the Graph origin. Connections can be tested.                                                    |
| Credential protection        | Client secrets are sealed with AES-256-GCM under `NF_DATA_KEY`. AAD binds each secret to its tenant and connector. Secrets are never returned; only the last four characters are shown.                                                                                                                                                  |
| Job system                   | MySQL queue (ADR 0008). Enqueue runs inside the business transaction. Claims use `SKIP LOCKED` with leases and heartbeats, then backoff, then dead-letter. A per-tenant concurrency cap applies, and jobs are handed back on shutdown. Separate worker process with its own systemd unit and scheduled syncs.                            |
| Machine identity             | Service principals with OAuth 2.0 client credentials (form and Basic auth). Secrets are stored as SHA-256 and can be rotated with overlap. Revoking or disabling takes effect immediately, and lowering permissions applies to live tokens. Permissions are limited to a machine subset, and routes must opt in with `@MachineAccess()`. |
| Admin Center                 | Directory (people and groups, with a members panel), Connectors (cards, sync history, test, pause, replace secret, delete) and Service principals (one-time secret reveal, rotate, revoke, disable). System health shows the background worker.                                                                                          |
| Operations                   | Worker unit, `NF_DATA_KEY` generation, extended sudoers rule, and worker health checks in deploy, rollback and validate. Updated runbook.                                                                                                                                                                                                |

## Evidence (CI run 42653337087, all jobs green)

- **Unit:** contracts permission rules (escalation paths excluded from machine permissions), sealed-secret crypto (tamper, wrong key, moved ciphertext), access tokens (alg=none, forged payload, wrong typ/issuer), and the security guard's bearer paths.
- **Integration** (MySQL 8.4 + Redis 7), with a Graph wire-format mock:
  - Full sync with paging and a 429 retry.
  - Delta sync: rename, delete, and membership add/remove.
  - Delta-token expiry falls back to a full sync.
  - A bad credential is dead-lettered and audited.
  - Tenant isolation on connectors, directory and members.
  - Job queue: retry, dead-letter, permanent errors, **chaos test (a crashed worker's job is re-run and nothing is lost)**, per-tenant fairness, and graceful hand-back.
  - Service principals: owner-only creation, escalation refused, uniform `invalid_client`, scope narrowing, immediate revocation, and cross-tenant isolation.
- **E2E:** an owner creates a service principal in the UI, sees the secret once, exchanges it for a token, and calls the directory API. Screenshots of the new pages are uploaded as the `ui-screenshots` artifact.

## Not claimed

- **Throughput target (100k users in under 10 minutes):** the load test has not been run, so the target is neither met nor missed yet.
- **Real tenant:** no sync has run against a real Entra tenant yet. That needs your app registration.
- **Phase 2b (not started):** per-tenant IdP, the Windows AD (.NET) connector, SAML/SCIM, the Go Linux agent, ESLint import boundaries, and OpenTelemetry.

## Production rollout

Pending authorisation. It requires re-running `install.sh` as root (adds `NF_DATA_KEY` and the worker unit), then deploying the release. See `docs/operations/deployment.md`, "Background worker and directory connectors".
