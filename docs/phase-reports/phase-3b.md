# Phase 3b report: email delivery, "Forgot password?" and sessions

_Branch `phase-3b-email-sessions` · 2026-11-10 · builds on ADR 0010_

## What was built

| Area                          | Delivered                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SMTP client (in-house)        | Written on `node:net` / `node:tls`: EHLO, STARTTLS, implicit TLS, AUTH PLAIN and LOGIN, dot-stuffing, and replies explained in plain language. Certificates are always verified. Extra CAs can be trusted with `NF_SMTP_CA_FILE`. It never sends a password unencrypted to a remote server. |
| Messages                      | MIME multipart/alternative: plain text plus HTML, UTF-8 and base64, with RFC 2047 encoded subjects and `Auto-Submitted`. Original branded templates for password reset, invitation/sign-in link and test.                                                                                   |
| Outbox                        | `email_messages`. Bodies (which can hold a one-time link) are sealed with `NF_DATA_KEY` and erased once sent or abandoned. The worker sends them through the job queue, with backoff and up to 6 attempts; 5xx replies fail permanently.                                                    |
| Organisation → Email delivery | Set up and edit the mail server, with presets for 587/STARTTLS, 465/TLS and a local relay. The password is stored sealed; only a hint is shown. "Send me a test" delivers right away and records the result. Recent messages show status, retries and errors. Pause or remove delivery.     |
| Safe targets                  | Only mail ports (25, 465, 587, 2525) unless the relay is on the server itself. Unencrypted connections only to the server itself. Link-local and metadata addresses are refused. Changing the server clears the last test result.                                                           |
| Forgot password?              | Offered on the sign-in screen when the organisation has email. The answer is always the same 202, whether or not the account exists. At most one email per person every 2 minutes. The link is the existing one-time reset link (24 h).                                                     |
| Admins email links            | "Also email it to them" when issuing a set-up or reset link. The link is still shown for copying.                                                                                                                                                                                           |
| Where you're signed in        | My account lists every active session: device, address, last active, and how it signed in (password or SSO). Sign out one session, or everywhere else.                                                                                                                                      |
| Sign out everywhere (admins)  | The identity panel shows the active session count. "Sign out everywhere" asks for a reason and follows the same containment rule as other credential actions.                                                                                                                               |

**Data:** migration `20261115000000_email_delivery` adds `tenant_email_settings` and
`email_messages`, with tenant-guard entries and grants. Five new audit actions:
`tenant.email_configured`, `tenant.email_removed`, `auth.password_reset_requested`,
`auth.session_revoked` and `auth.sessions_revoked`.

## Evidence

- **Integration (15 new tests, against a test SMTP server written for the suite):**
  - plain delivery with AUTH PLAIN, dot-stuffing and UTF-8;
  - 5xx is treated as permanent;
  - a remote plaintext password is refused, and "connection refused" is explained;
  - STARTTLS with certificate verification, and refusal of an untrusted certificate;
  - implicit TLS;
  - settings: only `tenant.manage` can change them; the password is never returned; optimistic
    concurrency;
  - port-scanner and metadata targets are refused;
  - a test send arrives with the stored credentials;
  - forgot password: identical answers for known and unknown accounts; rate limited; the emailed
    link works for sign-in; the body is erased after sending;
  - an admin-emailed invitation;
  - a failed delivery is recorded and its body erased;
  - sessions: list, end one, end the others, cannot end someone else's, admin sign-out
    everywhere with containment.
- **Full API suite:** 198 tests across 19 files pass on a fresh database.
- **End-to-end (10 tests, all pass):** the owner sets up email in the GUI against a local mail
  server and sends a test, which arrives; the sign-in screen then offers "Forgot password?" and
  shows "Check your email"; My account lists this browser's session.

## Not claimed

- **Not tested against a real provider.** No real mail provider (Microsoft 365, Gmail, Postfix)
  was used; the test server speaks the protocol, but providers have their own rules (sender
  verification, app passwords).
- **Deliverability is the organisation's own mail server's job.** SPF, DKIM and DMARC are not
  handled by Neural Frontier.
- **Passkeys are moved to the next slice.** Browsers allow them only on a domain name, never on an
  IP address, so they can't work on `https://192.168.197.100:8643` until a domain exists.
