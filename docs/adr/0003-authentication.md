# ADR-0003: Authentication — OIDC only, server-side sessions

- Status: Accepted · 2026-11-09

## Decision

1. **No local passwords.** Users sign in through the customer's identity provider using OpenID Connect
   authorization code flow with PKCE (S256), `state` and `nonce`. Any standards-compliant IdP works
   (Entra ID, Google Workspace, Okta, Keycloak…); the production IdP is not chosen yet. SAML, SCIM and
   passkey policy are Phase 2+.
2. **Server-side sessions, not browser-held JWTs.** A 256-bit random token in a `__Host-` cookie
   (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`); only its SHA-256 is stored. Idle timeout 30 min,
   absolute 12 h (configurable). Revocation (sign-out, suspension) is immediate.
3. **Permissions are resolved per request** from role assignments, never cached in the session, so
   revoking a role takes effect on the next request.
4. **CSRF**: `SameSite=Lax` plus, on every state-changing request, a same-origin `Origin` check and an
   `x-csrf-token` equal to HMAC(secret, sessionId).
5. **Login state** (state, nonce, PKCE verifier, return path) travels in a 10-minute AES-256-GCM-encrypted
   cookie, so no server state is needed before authentication.
6. **Account linking**: an identity is bound to `(issuer, subject)` on first sign-in. After that, the
   subject — not the email — identifies the user, so an email change at the IdP cannot hijack an account,
   and a second IdP account claiming the same email is refused (`subject_mismatch`).
7. **Tenant selection** by verified email domain. `email_verified` is required by default; IdPs that do not
   send it (notably Entra ID) need `NF_OIDC_REQUIRE_EMAIL_VERIFIED=false`, which is acceptable only when
   the IdP is authoritative for that domain — document this per tenant.
8. **Open redirects**: post-login return paths must be same-site relative paths.

## Consequences

- The API is not a public bearer-token API yet. Machine access (API keys / OAuth client credentials for
  connectors and the Developer Portal) is a separate design in Phase 2.
- A development OIDC provider (`tools/dev-idp`) exercises the real flow locally and in E2E tests; it
  refuses to start with `NODE_ENV=production`.
