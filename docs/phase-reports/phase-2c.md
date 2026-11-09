# Phase 2c report: SCIM 2.0 provisioning and single sign-out

_Branch `phase-2c-scim`, merged to `main` · 2026-11-10 · CI run 42662761896 (all jobs green)_

## What was built

| Area                                       | Delivered                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCIM 2.0 service provider (`/api/scim/v2`) | **Users:** list with `eq` filters (userName, externalId, id, emails) and paging; get, create, PUT, PATCH and DELETE. PATCH accepts Entra ID quirks (`"False"` as a string, path-less value objects). Returns RFC 7644 errors as `application/scim+json`, plus `ServiceProviderConfig` and `ResourceTypes`.              |
| Lifecycle rules                            | `userName` must be a work email on a verified domain, and new users get the Member role. Deactivating or deleting suspends the user and ends their sessions immediately; nobody is erased, so the audit trail stays intact. The last Tenant Owner can't be deactivated. Every change is audited as `scim:<token name>`. |
| SCIM tokens                                | Owner-only. 256-bit tokens, stored only as hashes, with expiry, a limit of 5 active per tenant, and immediate revocation. Shown once, together with the Tenant URL.                                                                                                                                                     |
| Single sign-out                            | Each session records the provider it signed in through and a sealed ID token. Sign-out returns the provider's end-session URL (`id_token_hint`, `post_logout_redirect_uri`, `state`), so the provider session ends too. This fixes the Phase 1 limitation where signing out didn't sign you out of the provider.        |
| Admin Center                               | An automatic provisioning card on the Organisation page. Identities show a "Managed by SCIM" badge.                                                                                                                                                                                                                     |

## Evidence

- **Integration:**
  - Token issuance is owner-only and the token is never listed.
  - Missing, forged and cookie credentials get 401 with an RFC 7644 error body.
  - Create sets the Member role and an audit actor.
  - Duplicates are refused (`uniqueness`), and so are foreign domains (`invalidValue`).
  - Filters work, and unsupported filters are refused (`invalidFilter`).
  - An Entra-style deactivation suspends the user and kills their live session at once.
  - Reactivation, PUT, and DELETE-as-deactivate work.
  - Last-owner protection holds.
  - Tenant isolation holds.
  - A revoked token is cut off immediately.
- **E2E:** signing out goes through the identity provider's end-session page, returns to "You've been signed out", and the next sign-in asks for credentials again.

## Not claimed

- **External conformance:** not run against the Microsoft SCIM validator or a real Entra tenant.
- **Not built yet:**
  - SCIM Groups. Clients should be configured for users only.
  - SAML 2.0.
  - The Windows AD (.NET) connector.
  - The Go Linux agent.
  - OpenTelemetry.
