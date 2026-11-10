# Phase 3c report: Neural Frontier as a sign-in provider (OpenID Connect)

_Branch `phase-3c-oidc-provider` · 2026-11-10 · ADR 0011_

Other applications can now offer **"Sign in with Neural Frontier"**. People use their existing
account, including two-step sign-in, and the organisation decides who may use each app.

## What was built

| Area                             | Delivered                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider endpoints (`/api/oidc`) | Discovery, JWKS, authorize, token, userinfo (GET/POST) and logout. CORS on the endpoints browsers call. `Cache-Control: no-store` on tokens.                                                                                                                                                                     |
| Flow                             | Authorization code with mandatory PKCE (S256), `state` and `nonce`. The `iss` parameter on responses (RFC 9207). `prompt=none` returns `login_required`; `login_hint` pre-fills the sign-in screen.                                                                                                              |
| Tokens                           | ES256 ID token (`sub`, `aud`, `azp`, `auth_time`, `nonce`, `sid`, `tid`, plus email, profile and roles by scope) and RFC 9068 access token, both 15 minutes. Codes: one use, 60 seconds.                                                                                                                         |
| Keys                             | Deployment signing key created on first use, sealed with `NF_DATA_KEY`. A key that can't be decrypted is rotated automatically. Retired keys stay published for 24 h.                                                                                                                                            |
| Admin Center → Applications      | Register web, single-page or mobile/desktop apps, set redirect and sign-out addresses, allow everyone or chosen roles, turn on/off, replace the secret, delete. The issuer and discovery URL are shown with copy buttons. The secret is shown once. Last-used time on each app.                                  |
| Safety                           | Exact redirect matching. https only, except http on loopback and reverse-DNS schemes for native apps. Unknown or misconfigured requests go to an explanation page (`/sign-in/app-error`), never to an unverified address. Sign-out needs a matching `id_token_hint`. Suspended people lose userinfo immediately. |
| Permissions and audit            | `applications.read` (Administrator, Security Auditor) and `applications.manage` (Administrator, Owner). Audit actions: `application.created`, `application.updated`, `application.deleted`, `application.secret_rotated`, and `auth.app_sign_in` (success and denied).                                           |

**Data:** migration `20261116000000_oidc_provider` adds `oauth_applications`,
`oauth_authorization_codes` and `oidc_signing_keys`, with tenant-guard entries and grants.

## Evidence

- **Integration (12 tests):** a test acting as the application covers:
  - registration rules: the secret is shown once, auditors can only read, unsafe redirect
    addresses are refused, native schemes are accepted;
  - discovery, and JWKS without private key material;
  - sign-in redirect with `login_hint`, and `prompt=none`;
  - code exchange: a wrong secret and a wrong PKCE verifier are refused, Basic auth works, the
    ID token is verified against the JWKS (issuer, audience, nonce, claims), a replayed code is
    refused, userinfo works, and an ID token used as an access token is refused;
  - unknown client and unregistered redirect go to the explanation page;
  - PKCE and the `openid` scope are required;
  - cross-tenant use is refused;
  - role-restricted apps;
  - public clients;
  - disabled apps and suspended people;
  - logout with and without a hint;
  - secret rotation.
- **End-to-end:** the owner registers an app in the GUI. **openid-client** (an independent,
  widely used OIDC client library) then:
  - discovers the provider;
  - builds a PKCE request, which the signed-in browser answers with a code;
  - exchanges the code, validating the ID token's signature, nonce and state;
  - fetches userinfo.

  The Admin Center shows the app as used, and the audit log shows the sign-in.

## Not claimed

- **No external certification.** The OpenID Foundation conformance suite hasn't been run.
- **Not built:** refresh tokens, dynamic client registration, front- and back-channel logout,
  pairwise subjects.
- **Keycloak is still in use** for this deployment's own single sign-on. Retiring it is the next
  step (3c-3).
- **Passkeys still need a domain name** (3c-2).
