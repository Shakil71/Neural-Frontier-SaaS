# ADR-0002: Modular monolith in an npm-workspaces monorepo

- Status: Accepted · 2026-11-09

## Decision

One API process with explicit domain modules (`apps/api/src/modules/*`), one web app, and shared
packages for contracts and data access, in a single repository using npm workspaces.

- Domains talk to each other through services, never through each other's tables.
- Shared types flow one way: `contracts` ← `db` ← `api`; `contracts` ← `web`.
- npm workspaces rather than pnpm/Turborepo: one fewer tool on the production host and in CI. Revisit
  when build times justify remote caching.

## Extraction criteria

A module becomes its own service only when at least one is true: it needs independent scaling (e.g.
connector gateway, AI execution), a different isolation boundary (execution plane must not share a
process with the control plane), or an independent release cadence. The connector gateway (planned
port 3402) is expected to be the first extraction.

## Consequences

Simple local development and deployment now; boundaries are enforced by convention and review, so ESLint
import-boundary rules should be added once a third consumer of a module appears.
