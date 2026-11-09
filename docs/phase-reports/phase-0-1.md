# Phase 0 + Phase 1 report

_Branch `phase-1-foundation` · 2026-11-09_

## Phase 0 — audit and planning

| Deliverable              | Location                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository audit         | Repository held only a placeholder Next.js page deployed to the VPS; nothing reusable beyond the runner and deploy path.                                                |
| Environment audit        | Oracle Linux 9.8, SELinux enforcing, firewalld, MySQL 8.4.13, Redis 7.2 (password), Nginx, Node 22.23; shared with other production apps; ports 3400–3402 and 8643 free |
| Dependency verification  | [ADR-0001](../adr/0001-technology-baseline.md) — versions checked against the registry; RCs and lint-incompatible majors rejected                                       |
| Architecture             | [overview](../architecture/overview.md), [data model](../architecture/data-model.md), ADRs 0002–0007                                                                    |
| Feature catalog          | [feature-catalog.md](../product/feature-catalog.md)                                                                                                                     |
| Microsoft 365 comparison | [m365-comparison.md](../product/m365-comparison.md)                                                                                                                     |
| Build vs integrate       | [build-vs-integrate.md](../product/build-vs-integrate.md)                                                                                                               |
| Threat model             | [threat-model.md](../security/threat-model.md)                                                                                                                          |
| ISO readiness plan       | [iso-readiness.md](../compliance/iso-readiness.md)                                                                                                                      |
| Prioritised backlog      | [backlog.md](../backlog.md)                                                                                                                                             |

## Phase 1 — what was built

**Created:** ~185 files (≈ 11.5 k lines excluding the lockfile): `apps/api` (42 source files, 4 test files),
`apps/web` (39 source files, 2 E2E files), `packages/contracts`, `packages/db` (schema + migration),
`tools/dev-idp`, `tools/license-check.mjs`, `deploy/oracle-linux` (18 files), `.github` workflows,
21 documents. **Removed:** the placeholder single-app layout and its auto-deploying workflow.

| Feature                                           | API | Persistence                | AuthZ                 | UI                | Errors | Tests                    | Docs             |
| ------------------------------------------------- | --- | -------------------------- | --------------------- | ----------------- | ------ | ------------------------ | ---------------- |
| OIDC sign-in, sessions, sign-out                  | ✓   | ✓                          | ✓                     | ✓                 | ✓      | unit + integration + E2E | ADR-0003         |
| Tenant isolation                                  | ✓   | ✓ (guard + composite FKs)  | ✓                     | —                 | ✓      | unit + integration       | ADR-0004         |
| RBAC, separation of duties                        | ✓   | ✓                          | ✓                     | ✓ (roles, matrix) | ✓      | unit + integration       | ADR-0005         |
| Identity suspend / reactivate                     | ✓   | ✓ (optimistic concurrency) | ✓                     | ✓                 | ✓      | integration              | —                |
| Role grant / revoke (idempotent, last-owner rule) | ✓   | ✓                          | ✓                     | ✓                 | ✓      | integration + E2E        | —                |
| Audit log                                         | ✓   | ✓ (append-only grants)     | ✓                     | ✓                 | ✓      | integration + E2E        | —                |
| Live dashboard                                    | ✓   | ✓                          | ✓                     | ✓                 | ✓      | integration (contract)   | —                |
| Health / metrics / logging                        | ✓   | —                          | ✓                     | ✓                 | ✓      | integration              | runbook          |
| Design system & Admin Center shell                | —   | —                          | ✓ (nav by permission) | ✓                 | ✓      | E2E + screenshots        | design-system.md |
| CI/CD & supply chain                              | —   | —                          | —                     | —                 | —      | —                        | ADR-0006         |
| Oracle Linux deployment kit                       | —   | —                          | —                     | —                 | —      | shellcheck               | deployment.md    |

## Tests and results

CI run `42613778973` on commit `b10b21c` — **all jobs passed**:

| Job                                                                                                                                                                                          | Result |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Format, lint (0 warnings), type check, unit tests (62), builds, OpenAPI drift, shellcheck                                                                                                    | ✅     |
| Integration — real MySQL 8.4 + Redis 7: tenant isolation, RBAC, CSRF, concurrency, idempotency, last-owner rule, SSO provisioning, contract validation, Redis rate limiting, migration drift | ✅     |
| End-to-end — Playwright, real OIDC sign-in through the dev IdP, role grant, audit, command palette, sign-out, CSP; screenshots of every screen in both themes (artifact `ui-screenshots`)    | ✅     |
| Supply chain — `npm audit` (0 high), registry signatures, licenses (637 packages), gitleaks, CycloneDX SBOM                                                                                  | ✅     |

The first CI run (`42612894985`) failed and found two real defects, both fixed: missing UserInfo fallback
for providers that omit email from the ID token, and the email-verification default.

## Security findings during the phase

| Finding                                                                                                             | Severity               | Resolution                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Root SSH accepts passwords from several networks; root password was shared in chat                                  | High (host)            | Not changed (other operators depend on it). Rotate the password; plan key-only root SSH; separate host before customer data. |
| Backup unit originally pointed at a script inside the service-user-writable release tree (root code execution path) | High                   | Fixed before commit: root scripts are installed root-owned in `/usr/local/lib/neural-frontier`                               |
| `email_verified` check skipped when OIDC config absent                                                              | Medium                 | Fixed: secure default `true` (found by integration test)                                                                     |
| Dark-theme button text contrast 3.3:1, light warning/success badges and `subtle` text below 4.5:1                   | Medium (accessibility) | Fixed: measured token values, all ≥ 4.5:1                                                                                    |
| Public repo + self-hosted runner                                                                                    | High if misconfigured  | CI never uses the self-hosted runner; deploy is manual, `main`-only, CI-green, environment-approved                          |

## Incomplete / not done (honest list)

- **Not deployed.** Per instruction ("prepare only"), nothing was changed on the VPS. The placeholder site
  on :8280 is still what is live.
- **No production identity provider** — sign-in on the server will show "SSO not configured" until one is chosen.
- GitHub branch protection and the `production` environment reviewers must be configured by the repository
  owner (runbook §0); I have no GitHub API credentials.
- No load tests; no performance or capacity claims.
- OpenTelemetry export, BullMQ, custom roles/ABAC, SAML/SCIM, passkeys: Phase 2+.
- Integration and E2E suites could not run on the development machine (running a downloaded MySQL binary
  was not permitted); they run in CI.

## Deployment status

Prepared and reviewed, not executed. Steps: runbook §0 (GitHub settings) → §1 `install.sh` → §2 IdP →
§3 bootstrap tenant → §4 Deploy workflow → §5 `validate.sh`.

## Next recommended milestone

1. Authorise the first rollout and choose the identity provider (Entra ID, Google Workspace, Okta, or a
   self-hosted Keycloak) — this makes Phase 1 usable.
2. Phase 2 kick-off: per-tenant IdP settings, machine identities for connectors, Microsoft Graph read-only
   sync, BullMQ job system, then the Windows AD connector.
