# ADR-0010: Built-in sign-in

- Status: Accepted · 2026-11-10

## Context

Until now every sign-in went through an external OpenID Connect provider: Keycloak on the VPS, or
a tenant's own provider (ADR 0009). The owner wants Neural Frontier to be a product people can
buy and run without operating a third-party identity server, with everything manageable in the
Admin Center. Organisations that already have Entra ID or Okta keep using single sign-on.

## Decision

- **Neural Frontier has its own accounts.** An identity can have a password and an
  authenticator-app second factor (`local_credentials`), alongside an optional single sign-on link.
  Both lead to the same identity, roles and audit trail.
- **No new dependencies.** Everything uses `node:crypto` and code in this repository:
  - **Passwords:** scrypt (N=2^15, r=8, p=1), salted and self-describing, so the parameters can
    be raised and older hashes are upgraded at the next sign-in.
  - **Two-step codes:** TOTP (RFC 6238, verified against the RFC test vectors), ±1 step of drift
    allowed, and an accepted step can never be used again.
  - **QR codes:** an in-house ISO/IEC 18004 encoder.
- **Secrets at rest:**
  - **Authenticator seeds:** sealed with `NF_DATA_KEY` (AES-256-GCM, bound to tenant + identity).
  - **Recovery codes:** ten one-time codes, stored as SHA-256 bound to the identity.
  - **Setup/reset links:** stored only as hashes.
- **The tenant decides how its people sign in.**
  - The owner-only sign-in policy chooses:
    - whether password sign-in is allowed;
    - whether two-step sign-in is required;
    - the minimum password length (10–64).
  - When an organisation requires its own provider (ADR 0009), password sign-in is refused too.
- **The sign-in screen asks for the email first.** The email's domain decides which methods are
  offered, never whether the account exists:
  - Unknown accounts get the same response as wrong passwords, after the same scrypt cost.
  - A clear "Continue with single sign-on" button keeps the SSO flow one click away.
- **Two-step sign-in without a half-session:**
  - After the password, the browser holds only an encrypted five-minute challenge cookie, never a
    session.
  - A required-but-missing authenticator is set up right there, before any session exists.
- **Getting people in, and back in, without email:**
  - Administrators issue one-time links: set-up (72 h) or reset (24 h).
  - The token travels in the URL fragment, so it never reaches server logs or `Referer` headers.
  - A new link voids the previous one.
  - A reset signs out every session.
  - Operators have a break-glass command (`sign-in-link.sh`), audited as `system:operator`.
- **Containment:**
  - An administrator can change someone's sign-in only if they hold every permission that
    person holds, so an Administrator can't take over an Owner.
  - Nobody can use the admin actions on themselves; their own settings live in My account.
  - Adding a first password from a session needs a sign-in in the last 15 minutes. A stolen
    long-lived cookie can't plant a password.
- **Brute force:**
  - Five failures lock the account for 1 minute, doubling up to 15 minutes.
  - Two-step codes count as failures too.
  - Every lock is audited, and administrators can unlock.
  - Per-IP rate limits apply on top.

## Consequences

- **Keycloak is now optional.** Phase 3c adds the outward-facing part (Neural Frontier as an
  OIDC provider) and a guided migration; after that, Keycloak can be removed from the VPS.
- **Email delivery isn't built yet (3b).** Until then, links are shared by an administrator. The
  sign-in screen says so honestly instead of offering a "forgot password" email that doesn't exist.
- **Passkeys (WebAuthn) are the next factor (3b).** The credential table is designed to grow.
