# Phase 3a report: built-in sign-in

_Branch `phase-3a-local-sign-in` · 2026-11-10 · ADR 0010_

Neural Frontier now has its own accounts, so an organisation can run it without an external
identity server. Single sign-on (OIDC) keeps working alongside.

## What was built

| Area                            | Delivered                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-in screen                  | Email first, then the methods that email's domain allows. Password, two-step code or recovery code. The authenticator is set up during sign-in when the organisation requires it, and recovery codes are shown once with copy and download. "Continue with single sign-on" stays one click away. |
| Set-up / reset links            | Administrators issue one-time links from the identity panel (set-up 72 h, reset 24 h). People land on a branded page and choose a password, with a live checklist that uses the same rules as the API.                                                                                           |
| My account → Security & sign-in | Change or add a password. Turn two-step sign-in on (QR code plus a key to type) or off. Replace recovery codes. The page shows how the current session signed in.                                                                                                                                |
| Administrators                  | A **Sign-in** section on every identity: password, two-step and SSO status, lockouts and pending links. Actions: create a link, reset two-step, unlock. Every action takes a reason and is audited.                                                                                              |
| Organisation → Built-in sign-in | Owner-only policy: password sign-in on/off, require two-step sign-in, minimum password length. Optimistic concurrency, audited with before and after values.                                                                                                                                     |
| Break-glass                     | `sudo /usr/local/lib/neural-frontier/sign-in-link.sh <email> "<reason>"` prints a one-time link. It runs the API's own command with the API's configuration and is audited as `system:operator`.                                                                                                 |
| Built in-house                  | TOTP (RFC 6238), scrypt hashing, base32 and a QR encoder (ISO/IEC 18004). No new dependencies.                                                                                                                                                                                                   |

**Data:** migration `20261114000000_built_in_sign_in` adds the tables `local_credentials`,
`recovery_codes`, `sign_in_links` and `tenant_sign_in_policies`. All four are added to the tenant
guard and to `grants.sql`.

## Evidence

- **Unit tests:**
  - HOTP and TOTP match the published test vectors (RFC 4226 appendix D, RFC 6238 appendix B).
  - Base32 matches the RFC 4648 vectors.
  - The ±1-step window, replay refusal and the otpauth URI format are tested.
  - scrypt hashing is salted and Unicode-normalised.
  - The QR encoder reproduces the standard's Reed–Solomon example (1-M "HELLO WORLD"), all
    level M format words, the version information for versions 7 and 40, the capacity table,
    the byte-mode layout, interleaving and the fixed patterns.
- **Integration (17 tests, real MySQL):**
  - Discovery is decided by domain only.
  - Cross-site or non-JSON requests are refused (login CSRF).
  - Links work once, can be inspected without being used, are voided by a newer link, and
    refuse weak passwords (422 with reasons).
  - Admin containment holds:
    - an Administrator can't target an Owner;
    - nobody can target themselves;
    - an Auditor can't issue links.
  - A wrong password and an unknown account get the same answer.
  - Unsafe `returnTo` values fall back to `/`.
  - Lockout:
    - five failures lock the account, even against the right password;
    - an admin unlock works;
    - both the lock and the unlock are audited.
  - Suspended people are refused.
  - Two-step sign-in:
    - enrolment works;
    - a code can't be reused;
    - a missing or forged challenge is refused;
    - a recovery code works once, in any case, with or without the dash;
    - an admin reset works.
  - The policy:
    - is owner-only, with conflict detection;
    - when two-step is required, it is set up during sign-in and can't be turned off;
    - turning password sign-in off refuses passwords and stops offering them.
  - Changing a password needs the current one and ends other sessions.
  - A first password needs a fresh sign-in.
  - Two-step can't be set up before a password exists.
- **Full API suite:** 183 tests across 18 files pass.
- **End-to-end (Playwright, 9 tests):**
  - The owner creates a link for Grace.
  - In her own browser, Grace:
    - sets a password, with the token cleared from the address bar;
    - is refused with a wrong password, then signs in;
    - turns on two-step sign-in from My account, with the code computed independently in the
      test;
    - must tick "I've saved these codes" before continuing;
    - signs out, then back in with password and code.
  - The owner sees "On" in Grace's panel and the event in the audit log.
  - The existing SSO, single sign-out, per-tenant IdP, service principal and server flows all
    still pass.
- **Bug found and fixed by the E2E test:** turning on two-step sign-in refreshed the page data,
  which removed the recovery-codes dialog before anyone could save the codes. The dialog now
  stays mounted outside the card.

## Not claimed

- **QR codes not scanned by a phone camera in CI.** The encoder passes the standard's reference
  values and the E2E test signs in with the key, but no camera scan has been automated. Scan it
  once with a phone after the deploy.
- **Not built yet (3b / 3c):**
  - Password-reset email and an outgoing mail client (3b).
  - Passkeys (3b).
  - Neural Frontier as an OIDC provider, and removing Keycloak (3c).
- **No password breach-list check.** A common-password list is built in; checking against
  breach corpora would need an external service or a large dataset.
