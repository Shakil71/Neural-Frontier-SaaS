# ISO / SOC 2 readiness plan

> Neural Frontier is **not certified** against any standard. Certification requires an independent,
> accredited audit of the operating organisation, not just the software. This plan tracks readiness.
> Standards texts must be obtained under licence (ISO, IEC, AICPA); none are reproduced here.

## Target frameworks and order

| Framework             | Why                                      | Target                                                 |
| --------------------- | ---------------------------------------- | ------------------------------------------------------ |
| ISO/IEC 27001 (ISMS)  | Baseline every enterprise buyer asks for | First — foundation for the rest                        |
| SOC 2 Type I → II     | US enterprise buyers                     | Alongside 27001 (large control overlap)                |
| ISO/IEC 27017 / 27018 | Cloud security / PII in public cloud     | With SaaS launch (Phase 9)                             |
| ISO/IEC 27701         | Privacy information management           | After 27001                                            |
| ISO/IEC 42001         | AI management system                     | Before AI execution features reach customers (Phase 5) |
| ISO 22301             | Business continuity                      | With HA/DR (Phase 10)                                  |
| ISO/IEC 20000-1       | IT service management                    | If managed-service offering is pursued                 |

## Technical controls already in place (Phase 1)

| Control theme                    | Evidence in this repository                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| Access control & least privilege | RBAC catalog, central guard, per-table DB grants, sudo limited to two units           |
| Separation of duties             | Only Owners grant roles (unit-tested)                                                 |
| Authentication                   | OIDC + PKCE, server sessions, idle/absolute expiry                                    |
| Logging & monitoring             | Append-only audit trail, structured logs with request ids, Prometheus metrics         |
| Secure development               | Strict TypeScript, lint, tests (unit/integration/E2E), CodeQL, code review via PRs    |
| Change management                | Manual, approval-gated deployments; release history; automatic rollback               |
| Supply chain                     | Lockfile, signature audit, pinned actions, SBOM, license gate, provenance attestation |
| Cryptography                     | TLS, AES-256-GCM login state, SHA-256 token hashing, encrypted backups                |
| Backup & restore                 | Daily encrypted backups, weekly automated restore test with recorded result           |
| Secure configuration             | Hardened systemd units, SELinux enforcing, config validated at start-up               |
| Threat & risk analysis           | [threat model](../security/threat-model.md)                                           |

## Organisational gaps (not software — must be done by the company)

ISMS scope and policy · risk methodology and register · Statement of Applicability · asset inventory ·
roles and responsibilities · HR security (screening, training, NDAs) · supplier management (GitHub, hosting,
IdP, future AI providers) · incident response plan and exercises · business continuity plan · internal audit
programme · management review · document control · access reviews on a schedule.

## Roadmap

| Phase   | Readiness milestone                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------- |
| 1 (now) | Threat model, technical baseline above, this plan                                                     |
| 2–3     | Risk register and SoA drafted; incident runbooks; access-review report export                         |
| 5       | ISO 42001 AI impact assessments; AI evaluation records                                                |
| 8       | Trust & Compliance Center in-product: control ownership, evidence collection, internal audit workflow |
| 9       | Readiness assessment by an external consultant; SOC 2 Type I                                          |
| 10      | ISO 27001 certification audit (Stage 1 & 2); SOC 2 Type II observation period                         |
