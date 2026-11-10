# ADR-0011: Neural Frontier as an OpenID Connect provider

- Status: Accepted · 2026-11-10

## Context

Organisations want their other applications (portals, internal tools, mobile apps) to sign people
in with the same account, two-step sign-in and policy they already have in Neural Frontier.
The deployment itself still uses Keycloak as a provider for sign-in; the owner wants to stop
depending on it (ADR 0010).

## Decision

- **One issuer per deployment:** `<public URL>/api/oidc`, with standard discovery and JWKS.
  Applications are registered per tenant. An application signs in only people of its own
  tenant, and optionally only holders of chosen roles.
- **Authorization code flow only, PKCE (S256) always required.**
  - Web applications also authenticate with a client secret (`client_secret_basic` or
    `client_secret_post`). Secrets are 256-bit, stored as SHA-256 and shown once.
  - Single-page and native applications are public clients: PKCE only, and sending a secret is
    refused.
  - No implicit or hybrid flows, and no password grant.
- **Redirect URIs must match exactly.** Allowed forms:
  - https;
  - http only for loopback addresses;
  - reverse-DNS custom schemes for native apps.
    An unknown client or an unregistered redirect URI is never redirected to: the person sees an
    explanation page instead.
- **Tokens:**
  - ES256, 15-minute ID tokens and RFC 9068 access tokens, signed with a deployment key.
  - The private key is sealed with `NF_DATA_KEY`.
  - A key that can't be decrypted (for example after the data key changed) is retired and
    replaced automatically.
  - Retired keys stay published for 24 hours.
  - Claims by scope: `email`, `profile`, and `roles` (role keys); `tid` is always included.
- **Codes:** one use, 60 seconds, bound to the redirect URI, the PKCE challenge and the session.
  A code whose session has ended or whose person was suspended can't be exchanged.
- **Sign-in reuses everything already built.** Password, two-step sign-in, single sign-on and the
  tenant sign-in policy all apply, because the authorization endpoint simply requires a
  Neural Frontier session.
- **RP-initiated logout ends the session only with a valid `id_token_hint` for the same person.**
  A bare link can't sign people out. It redirects only to registered sign-out addresses.
- **No consent screen.** Applications are registered by the organisation's own administrators
  for their own people, so they are first-party.

## Consequences

- **Keycloak can be retired.** Once every administrator has a built-in password (or the
  organisation uses its own provider), the deployment-wide Keycloak configuration can be
  removed (Phase 3c-3).
- **Not built yet:** refresh tokens, dynamic client registration, front- and back-channel
  logout, and pairwise subject identifiers. Add them when an application needs them.
