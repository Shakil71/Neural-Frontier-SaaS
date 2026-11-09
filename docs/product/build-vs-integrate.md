# Build-versus-integrate decision matrix

Scoring 1 (low) – 5 (high). **Build** when the capability is a differentiator _and_ we can reach
production quality; **integrate/embed** when maturity, security risk or standards complexity dominate.
Every embedded component must pass the license policy (`tools/license-check.mjs`, license register).

| Capability                                      | Differentiation | Build effort / risk   | Mature options exist | Decision                                                             | Candidates to evaluate                             |
| ----------------------------------------------- | --------------- | --------------------- | -------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| Control plane (tenancy, RBAC, audit, workflows) | 5               | 3                     | 2                    | **Build**                                                            | —                                                  |
| Admin/AI experience                             | 5               | 3                     | 1                    | **Build**                                                            | —                                                  |
| OIDC/SAML identity provider                     | 2               | 5                     | 5                    | **Integrate** (customer IdP); embed IdP only for self-hosted edition | Keycloak, Zitadel, Authentik                       |
| AD / Entra management                           | 4               | 3                     | 3 (Graph APIs)       | **Build connectors** on Graph / LDAP / PowerShell handlers           | Microsoft Graph SDK                                |
| Linux / Windows agents                          | 4               | 4                     | 3                    | **Build** (Go / .NET), reuse OSS collectors where license-compatible | osquery (Apache-2.0) as inventory source           |
| Firewall / VPN / network                        | 4               | 4                     | 3                    | **Build adapters** over vendor APIs; OSS for SNMP/syslog             | Vendor REST APIs, net-snmp                         |
| Cloud inventory                                 | 3               | 3                     | 4                    | **Build adapters** on official SDKs                                  | AWS/Azure/GCP SDKs                                 |
| Mail transport & storage                        | 2               | 5 (security-critical) | 5                    | **Embed OSS engine**, build admin                                    | Stalwart (AGPL — license review!), Postfix+Dovecot |
| Chat / meetings                                 | 2               | 5                     | 4                    | **Embed OSS**                                                        | Matrix (Synapse/Dendrite), LiveKit, Jitsi          |
| Document co-editing                             | 2               | 5                     | 4                    | **License an engine**                                                | OnlyOffice, Collabora (commercial terms needed)    |
| File storage                                    | 3               | 3                     | 5                    | **Build service** on S3-compatible storage                           | MinIO / Ceph / cloud object storage                |
| Search                                          | 2               | 4                     | 5                    | **Integrate**                                                        | OpenSearch                                         |
| Malware scanning                                | 1               | 5                     | 4                    | **Integrate**                                                        | ClamAV, commercial engines                         |
| AI models                                       | 3               | 5                     | 5                    | **Integrate via gateway**; tenant-controlled provider choice         | Hosted LLM APIs, self-hosted open-weight models    |
| Billing / payments                              | 1               | 4 (PCI)               | 5                    | **Integrate**                                                        | Stripe, Paddle                                     |
| Observability                                   | 1               | 3                     | 5                    | **Integrate** (Prometheus/Grafana already on host)                   | OpenTelemetry, Prometheus, Loki                    |
| Secrets / KMS                                   | 1               | 5                     | 5                    | **Integrate**                                                        | HashiCorp Vault / OpenBao, cloud KMS               |

## AGPL caution

AGPL-licensed servers (some mail and collaboration engines) impose source-disclosure obligations when
modified and offered as a network service. They may be operated **unmodified as separate services**
after legal review, never linked into Neural Frontier code. The license gate forbids AGPL in our
dependency tree.
