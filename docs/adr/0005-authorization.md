# ADR-0005: Authorization — code-defined permissions, RBAC now, ABAC next

- Status: Accepted · 2026-11-09

## Decision

- Permissions are a **closed, code-defined catalog** (`packages/contracts/src/permissions.ts`). Roles are
  sets of catalog keys stored per tenant; unknown keys found in the database are ignored, never granted.
- Four built-in roles: **Tenant Owner** (everything), **Administrator** (manage but cannot grant roles),
  **Security Auditor** (read-only incl. audit), **Member** (no admin access).
- **Separation of duties**: only Tenant Owners hold `roles.assign`; a unit test fails if another built-in
  role gains it.
- One global guard enforces authentication, CSRF and `@RequirePermission` on every route —
  deny-by-default. There is no per-controller authorization logic to drift.
- **Invariants** enforced transactionally: a tenant always keeps one active owner (row locks prevent two
  concurrent removals both succeeding); nobody can suspend themselves.

## Next (Phase 2–5)

Attribute-based conditions (resource ownership, organisational unit, time windows, device posture),
custom roles, just-in-time elevation with approvals, and access reviews — added to the same central
service so there is still exactly one decision point.
