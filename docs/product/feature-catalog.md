# Feature catalog

_Every capability Neural Frontier intends to offer, how it will be delivered, and its real status.
Last updated 2026-11-09 (end of Phase 1)._

**Delivery** — how the capability is provided:
`Native` built by Neural Frontier · `Graph` Microsoft Graph integration · `Vendor` third-party commercial
integration/API · `OSS` licensed open-source component embedded or operated by us.

**Status** — `✅ Built` (API + persistence + authorization + UI + errors + tests + docs, verified) ·
`🟡 Partial` · `⬜ Planned (Phase n)`. Nothing below is marketed as available unless it is ✅.

## Platform foundation

| Capability                                                     | Delivery     | Status        |
| -------------------------------------------------------------- | ------------ | ------------- |
| Multi-tenant data model with enforced isolation                | Native       | ✅ Built      |
| OIDC single sign-on (any compliant IdP), PKCE                  | Native       | ✅ Built      |
| Server-side sessions, idle/absolute expiry, revocation         | Native       | ✅ Built      |
| RBAC with built-in roles, separation of duties                 | Native       | ✅ Built      |
| Append-only audit log (UI + API)                               | Native       | ✅ Built      |
| Identity lifecycle: suspend / reactivate with reason           | Native       | ✅ Built      |
| Role grant / revoke with idempotency and last-owner protection | Native       | ✅ Built      |
| Live identity & access dashboard                               | Native       | ✅ Built      |
| Health, readiness, Prometheus metrics, structured logs         | Native       | ✅ Built      |
| OpenAPI document                                               | Native       | ✅ Built      |
| SAML 2.0 SSO, SCIM provisioning                                | Native       | ⬜ Phase 2    |
| Passkeys / WebAuthn, MFA policy enforcement                    | Native + IdP | ⬜ Phase 2    |
| Custom roles, ABAC conditions, JIT elevation, access reviews   | Native       | ⬜ Phase 2–5  |
| OAuth client credentials (service principals)                  | Native       | ✅ Built (2a) |
| Webhooks, Developer Portal                                     | Native       | ⬜ Phase 9    |
| OpenTelemetry tracing export                                   | OSS (OTel)   | ⬜ Phase 3    |
| Background jobs: retries, dead-letter, per-tenant fairness     | Native       | ✅ Built (2a) |

## Frontier Identity

| Capability                                                           | Delivery                        | Status        |
| -------------------------------------------------------------------- | ------------------------------- | ------------- |
| Active Directory users, groups, OUs, computers (multi-domain/forest) | Native Windows connector (.NET) | ⬜ Phase 2    |
| Microsoft Entra ID users, groups, memberships (read-only delta sync) | Graph                           | ✅ Built (2a) |
| Hybrid sync visibility                                               | Graph                           | ⬜ Phase 2    |
| Conditional Access policy visibility                                 | Graph                           | ⬜ Phase 2    |
| Privileged identity governance, delegated administration             | Native                          | ⬜ Phase 5    |
| Identity risk analytics                                              | Native + AI                     | ⬜ Phase 4    |

## Infrastructure & security operations

| Capability                                                                                                 | Delivery              | Status       |
| ---------------------------------------------------------------------------------------------------------- | --------------------- | ------------ |
| Linux server inventory, services, packages, patch compliance                                               | Native Go agent       | ⬜ Phase 2–3 |
| Windows server/endpoint inventory, event logs, updates                                                     | Native .NET agent     | ⬜ Phase 2–3 |
| Firewall inventory/policy analysis (Fortinet, Palo Alto, pfSense, OPNsense, MikroTik, firewalld, nftables) | Vendor APIs / Native  | ⬜ Phase 3   |
| VPN gateways & sessions (WireGuard, OpenVPN, IPsec, vendor)                                                | Native / Vendor       | ⬜ Phase 3   |
| Network devices, SNMP, syslog, topology, config backups                                                    | Native / OSS          | ⬜ Phase 3   |
| Azure / AWS / Google Cloud inventory, IAM, cost                                                            | Vendor APIs           | ⬜ Phase 3   |
| Vulnerability, incident, backup/DR, license, ITSM, CMDB modules                                            | Native + integrations | ⬜ Phase 3–8 |
| Approval-based changes with rollback plans                                                                 | Native                | ⬜ Phase 5   |

## AI platform

| Capability                                                               | Delivery | Status     |
| ------------------------------------------------------------------------ | -------- | ---------- |
| Model gateway (provider-agnostic, tenant data boundaries, cost tracking) | Native   | ⬜ Phase 4 |
| 18 specialised agents (read-only first) with typed tools and evidence    | Native   | ⬜ Phase 4 |
| Approval-gated execution, risk classification, red-team evals            | Native   | ⬜ Phase 5 |

## Digital workplace (Microsoft 365-class)

| Capability                                                         | Delivery                                                                                   | Status       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------ |
| Frontier Drive (files, sharing, versioning, retention)             | Native over S3-compatible storage; malware scan via OSS (ClamAV)                           | ⬜ Phase 6   |
| Frontier Workspace (intranet, knowledge base, search)              | Native + OSS search                                                                        | ⬜ Phase 6   |
| Frontier Projects, Forms                                           | Native                                                                                     | ⬜ Phase 6   |
| Frontier Mail (mailboxes, calendar, contacts)                      | OSS mail engine (evaluate Stalwart/Dovecot+Postfix) + Native admin; Graph for M365 tenants | ⬜ Phase 7   |
| Frontier Connect (chat, calls, meetings)                           | OSS (evaluate Matrix + LiveKit/Jitsi) + Native                                             | ⬜ Phase 7   |
| Frontier Docs (documents, spreadsheets, presentations, co-editing) | Licensed engine (evaluate OnlyOffice/Collabora — licensing review required)                | ⬜ Phase 7   |
| Frontier Analytics, People, Studio (low-code)                      | Native                                                                                     | ⬜ Phase 6–9 |

## Governance & commercial

| Capability                                                     | Delivery                           | Status      |
| -------------------------------------------------------------- | ---------------------------------- | ----------- |
| Trust & Compliance Center (ISMS, risk register, SoA, evidence) | Native                             | ⬜ Phase 8  |
| DLP, retention, legal hold, data export/deletion workflows     | Native                             | ⬜ Phase 8  |
| Subscriptions, seats, usage billing                            | Vendor (payment provider) + Native | ⬜ Phase 9  |
| Private cloud / self-hosted editions, white-label              | Native                             | ⬜ Phase 9  |
| Multi-region, HA, DR                                           | Native + cloud                     | ⬜ Phase 10 |
