# Threat model

_Scope: Phase 1 system as built (Admin Center, control-plane API, MySQL, Redis, Nginx, CI/CD, VPS).
Method: data-flow diagram + STRIDE per element. Reviewed 2026-11-09. Re-review at each phase gate and
whenever a trust boundary changes._

## Assets

Tenant identity data · role assignments (privilege) · session tokens · audit trail integrity · OIDC
client secret · session secret · DB/Redis credentials · backup encryption key · deploy pipeline / runner ·
the shared VPS and its other tenants' applications.

## Trust boundaries

1. Internet/LAN → Nginx (TLS)
2. Nginx → web/API on loopback
3. API → MySQL / Redis (loopback, distinct least-privilege accounts)
4. API ↔ customer IdP (OIDC over TLS)
5. GitHub (public repo, hosted CI) → self-hosted runner on the production host
6. Neural Frontier processes ↔ other applications on the same VPS

## STRIDE analysis

| #   | Threat                                                      | Element   | Mitigation (implemented)                                                                                                                                                                 | Residual / planned                                        |
| --- | ----------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| S1  | Session hijack via stolen cookie                            | Browser   | `__Host-` HttpOnly Secure cookie; token hashed at rest; idle 30 min / absolute 12 h; revoke on suspend & sign-out                                                                        | Device binding / DPoP — P8                                |
| S2  | Account takeover via IdP email change or second IdP account | Auth      | Bind `(issuer, subject)` on first sign-in; refuse `subject_mismatch`; require `email_verified`                                                                                           | Per-tenant IdP config — P2                                |
| S3  | Login CSRF / state injection                                | Auth      | `state`, `nonce`, PKCE S256; encrypted short-lived login-state cookie                                                                                                                    | —                                                         |
| S4  | Forged request id / log injection                           | API       | Upstream ids accepted only if `[A-Za-z0-9._-]{8,64}`                                                                                                                                     | —                                                         |
| T1  | Cross-tenant data access (IDOR)                             | API/DB    | Tenant from session only; Prisma tenant guard; composite FKs; integration tests per endpoint                                                                                             | Periodic automated cross-tenant fuzzing — P2              |
| T2  | CSRF on state changes                                       | API       | Same-origin `Origin` check + session-bound HMAC CSRF token + SameSite=Lax                                                                                                                | —                                                         |
| T3  | Audit tampering                                             | DB        | Runtime DB user lacks UPDATE/DELETE on `audit_events`; audit written in the same transaction as the change                                                                               | Hash-chained, externally anchored export — P8             |
| T4  | Lost update races                                           | API       | Optimistic concurrency (`version`); row locks for last-owner invariant                                                                                                                   | —                                                         |
| T5  | Supply-chain compromise (dependency, action)                | CI        | Lockfile + `npm audit signatures`; exact pins; actions pinned by SHA; Dependabot; license gate; SBOM; build provenance attestation                                                       | Verify attestation before activation on host — P2         |
| R1  | Admin denies a change                                       | Audit     | Actor, target, reason, IP, request id on every privileged change and denial                                                                                                              | —                                                         |
| I1  | Error messages leak internals                               | API       | Central filter returns contract errors only; stack traces logged server-side                                                                                                             | —                                                         |
| I2  | Secrets in logs                                             | Logging   | pino redaction of cookies, authorization, CSRF header, set-cookie                                                                                                                        | Log scanning in CI — P3                                   |
| I3  | Metrics / API docs exposed                                  | Nginx/API | Nginx 404 for `/api/metrics`, `/api/docs`; metrics answer loopback-only without proxy headers; docs off in production                                                                    | —                                                         |
| I4  | Secrets in source control                                   | Repo      | `.env*` ignored; gitleaks in CI; env files generated on host (0640/0600)                                                                                                                 | —                                                         |
| I5  | Backup disclosure                                           | Backups   | AES-256 + PBKDF2 key file (root 0600); root-only directory                                                                                                                               | Off-host copy with separate key — P8                      |
| D1  | Brute force / request floods                                | Nginx/API | Nginx `limit_req`; Redis-backed throttler (300/min/IP, auth 20/min); body limit 256 KB                                                                                                   | WAF / CDN in cloud phase                                  |
| D2  | Resource exhaustion affecting co-hosted apps                | Host      | systemd `MemoryMax=2G`, nofile limits                                                                                                                                                    | CPU quotas after load tests                               |
| E1  | Privilege escalation inside a tenant                        | Authz     | Central guard, deny-by-default; only Owners hold `roles.assign`; last-owner invariant; denials audited                                                                                   | Approval workflow for privileged grants — P5              |
| E2  | Malicious PR runs on production runner                      | CI        | Repo is public: CI uses GitHub-hosted runners only; deploy runs only for `main`, manual, environment approval, CI-green check                                                            | Runner in a dedicated VM/user namespace — P10             |
| E3  | Runner/service user → root                                  | Host      | `neural` sudo limited to restarting two units; root-run scripts installed root-owned outside writable paths; hardened units (`NoNewPrivileges`, no capabilities, `ProtectSystem=strict`) | —                                                         |
| E4  | Compromise spreads to other apps on the shared VPS          | Host      | Dedicated user, DB, Redis ACL (`~nf:*`), loopback ports, SELinux enforcing                                                                                                               | Separate host — strongly recommended before customer data |

## Known risks accepted for now

- **Shared production host.** Root SSH accepts passwords from several networks and the root password was
  shared in a chat. Recommendation: rotate it, move to key-only SSH for root once the other operators have
  keys, and give Neural Frontier its own host before onboarding customers.
- **Self-signed certificate** until a domain exists (no HSTS; browser warnings train users to click through).
- **Single node**: no HA; RPO ≤ 24 h (daily backup), RTO ≈ 1 h (manual restore). Improves in Phase 10.

## Future-phase threats (design now, mitigate when built)

AI plane: prompt injection via ingested data, tool-call escalation, data exfiltration to model providers,
hallucinated remediation. Planned controls: typed allowlisted tools, server-side policy evaluation,
human approval for impactful actions, no model-generated shell, tenant-scoped retrieval, output validation,
red-team suites. Execution plane: certificate-identified agents with mTLS, signed commands, idempotent
handlers, per-connector credentials never visible to the AI plane.
