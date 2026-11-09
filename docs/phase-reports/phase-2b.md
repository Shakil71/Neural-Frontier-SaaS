# Phase 2b report: per-tenant single sign-on and architecture boundaries

_Branch `phase-2b-sso`, merged to `main` · 2026-11-10 · CI run 42658366473 (all jobs green)_

## What was built

| Area                           | Delivered                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-tenant OIDC provider       | Owner-only (`tenant.sso.manage`). Settings are validated by discovery before they are saved. The secret is sealed with `NF_DATA_KEY`, and the issuer is stored exactly as the provider states it.                                                                                                                                                                                            |
| Email-first sign-in            | The email domain picks the provider, which receives the address as `login_hint`. The login-state cookie records which provider the sign-in started at.                                                                                                                                                                                                                                       |
| Containment and migration      | A tenant's provider signs people in only to its own tenant. An identity moves to the tenant's provider on its first sign-in through it, and the move is audited. `required` enforcement is allowed only after the owner has signed in through the provider. Changing the issuer resets the setting to `optional`. Removing the provider unlinks people who moved, so they aren't locked out. |
| Admin Center                   | A single sign-on card on the Organisation page (connect, edit, require, remove), and a new sign-in page with a work-email field.                                                                                                                                                                                                                                                             |
| Architecture boundaries (lint) | Contracts stay browser-safe and independent. The db package never imports apps. The web app can't import the database or API code. Web features don't import each other. API modules don't import controllers or entry points. Verified by making a deliberate violation in each area.                                                                                                       |

## Evidence

- **Integration** (MySQL 8.4), against mock OIDC issuers:
  - Owner-only configuration, discovery validation, and a sealed secret that is never returned.
  - Email-first routing to the tenant's provider (with `login_hint` and PKCE), and to the shared provider otherwise.
  - Cross-tenant assertions are refused (`idp_tenant_mismatch`).
  - Moving an identity between providers works, and the same issuer with a new subject is still refused.
  - `required` is refused before a proven sign-in, then blocks the shared provider.
  - Changing the issuer resets enforcement; removal unlinks people who moved.
- **E2E** (real browser, two real OIDC providers):
  1. Acme's owner connects Acme's own provider in the UI.
  2. Signing in with the work email goes to that provider (port 3498, not the shared 3499).
  3. The owner requires the provider.
  4. Signing in through the shared provider is then refused with a clear message.

  This meets the backlog acceptance criterion: "sign-in works for two tenants with different IdPs".

## Not done in 2b

- SAML 2.0 and SCIM 2.0 provisioning.
- The Windows AD connector (.NET).
- The Go Linux agent.
- OpenTelemetry tracing.
- RP-initiated logout.

## Production

Phases 2a and 2b are not deployed. Deployment needs the owner's go-ahead and a one-time `install.sh` re-run (see the runbook).
