# ADR-0009: Per-tenant single sign-on

- Status: Accepted · 2026-11-10

## Context

Phase 1 had one deployment-wide OIDC provider (`NF_OIDC_*`), and the verified email domain
decided the tenant. Organisations want their people to use their own provider (Entra ID, Okta,
Google Workspace) with their own MFA and lifecycle. A careless design lets one tenant's provider
assert email addresses that belong to another tenant.

## Decision

- **One optional OIDC provider per tenant** (`tenant_identity_providers`). The client secret is
  sealed with `NF_DATA_KEY`. The issuer is stored exactly as the provider states it in discovery,
  because ID tokens must match it byte for byte. Only Tenant Owners can manage it
  (`tenant.sso.manage`).
- **Validated before saving.** The discovery document must load. The deployment's own shared
  issuer is refused as a tenant provider.
- **Email-first sign-in.** The email domain selects the provider. The email only routes the user
  and proves nothing: the identity comes from the provider's signed ID token, and the address is
  passed on as `login_hint`. The login-state cookie records which provider the sign-in started
  at, and the callback completes with that same provider.
- **Containment.** A tenant's provider can sign people in only to that tenant
  (`idp_tenant_mismatch`), whatever email it asserts. A known `(issuer, subject)` pair still wins,
  but it is checked against the same rule.
- **Moving a tenant.** On the first sign-in through the tenant's provider, an identity bound to a
  different issuer is re-bound, and the sign-in event's metadata records `relinkedFrom`. The same
  issuer with a different subject is refused, as before. Only the tenant's owner can choose to
  trust that provider for the tenant's verified domains.
- **Enforcement.** `optional` (both providers work) or `required` (the shared provider is refused
  for this tenant). Switching to `required` is allowed only once the acting owner has signed in
  through the tenant's provider, which proves it works. Changing the issuer resets the setting to
  `optional`.
- **Removal** unlinks people bound to the removed issuer, so they re-link through the shared
  provider. Removal is refused when the deployment has no shared provider, because nobody could
  sign in.

## Consequences

- Per-tenant SAML 2.0 is not covered and will be a separate decision.
- Signing out of Neural Frontier still doesn't end the provider's session (RP-initiated logout is
  in the backlog).
- The CSP keeps `form-action 'self'`. The sign-in form therefore navigates with script rather
  than a native form post, because browsers apply `form-action` to the redirect to an external
  provider.
