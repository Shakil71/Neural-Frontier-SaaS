# ADR-0001: Technology baseline and version policy

- Status: Accepted · 2026-11-09

## Context

The directive requires modern, supported, strongly typed technology with pinned, reproducible versions,
and forbids adopting experimental releases just because they are new. Versions were checked against the
npm registry on 2026-11-09.

## Decision

All direct dependencies are pinned to exact versions (`save-exact`) and locked in `package-lock.json`.

| Area        | Choice                                                                                                                                   | Notes                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime     | Node.js 22 LTS (22.23 on the host)                                                                                                       | The VPS's system Node is shared with other production apps, so upgrading it is out of scope. 24 LTS is the next target; CI runs 22 to match. |
| Language    | TypeScript **6.0.3**, strict                                                                                                             | TS 7.0 (native compiler) is released, but `typescript-eslint` supports `<6.1`. Revisit when lint tooling supports 7.                         |
| Web         | Next.js 16.4, React 19.3, Tailwind 4.3, Radix UI 1.8, TanStack Query 5 / Table 9, React Hook Form 7, Zod 4, ECharts 6, Motion 14, Lucide |                                                                                                                                              |
| API         | NestJS 12.4 (ESM), Zod validation, `@nestjs/swagger`, pino, prom-client, helmet, `@nestjs/throttler`                                     | NestJS 12 is ESM-only; the API, contracts and db packages are ESM (`NodeNext`).                                                              |
| Auth        | `openid-client` 6 (relying party), `jose` 6                                                                                              |                                                                                                                                              |
| Data        | MySQL 8.4 LTS, Prisma **7.10.1** + `@prisma/adapter-mariadb`                                                                             | npm's `latest` tag for Prisma points to `8.0.0-rc.*` — a release candidate. Stay on 7.x until 8 is GA.                                       |
| Cache       | Redis 7.2 via ioredis 6                                                                                                                  |                                                                                                                                              |
| Lint/format | ESLint **9.39** (maintained line), Prettier 3                                                                                            | ESLint 10 exists; Next's lint presets target 9.                                                                                              |
| Tests       | Vitest 5, Supertest, Playwright 1.65                                                                                                     |                                                                                                                                              |

Validation uses Zod rather than `class-validator`, so the browser and the API validate against the same
schemas in `@nf/contracts`.

## Consequences

- Dependabot opens grouped weekly update PRs; CI (audit, license check, tests) gates them.
- Upgrades that cross a major version get their own ADR amendment.
