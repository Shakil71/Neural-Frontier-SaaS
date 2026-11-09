# Developer guide

## Prerequisites

Node.js 22.12+ (CI and production use 22; 24/26 work locally), npm 10+, a MySQL 8.4 database you can
drop, and optionally Redis 7.

## Setup

```bash
npm ci
npm run build:packages            # contracts + db (generates the Prisma client)
```

Create `apps/api/.env` (never commit it):

```dotenv
NODE_ENV=development
DATABASE_URL=mysql://root:root@127.0.0.1:3306/nf_dev?allowPublicKeyRetrieval=true
NF_PUBLIC_URL=http://localhost:3400
NF_SESSION_SECRET=dev-only-secret-at-least-32-characters-long
NF_COOKIE_SECURE=false
NF_OIDC_ISSUER=http://localhost:3499
NF_OIDC_CLIENT_ID=neural-frontier-dev
NF_OIDC_CLIENT_SECRET=dev-secret-not-for-production
NF_OIDC_ALLOW_INSECURE_HTTP=true
NF_API_DOCS=true
```

Migrate and bootstrap a tenant:

```bash
DATABASE_URL=… npm run db:migrate
DATABASE_URL=… NF_BOOTSTRAP_TENANT_NAME="Acme Robotics" NF_BOOTSTRAP_TENANT_SLUG=acme \
  NF_BOOTSTRAP_DOMAIN=acme.example NF_BOOTSTRAP_OWNER_EMAIL=ada@acme.example \
  NF_BOOTSTRAP_OWNER_NAME="Ada Owner" npm run db:seed
```

Run (three terminals):

```bash
npm run dev:idp                   # development OIDC provider on :3499
npm run build -w @nf/api && npm run dev:api    # API on :3401 (watches dist; rebuild on change)
npm run dev:web                   # Admin Center on http://localhost:3400
```

Sign in with **ada@acme.example** and any password at the development IdP. API docs:
http://localhost:3401/api/docs.

## Tests

| Command                                                           | What                                                                                               | Needs                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `npm test`                                                        | Unit tests (all workspaces)                                                                        | nothing                                            |
| `TEST_DATABASE_URL=… [TEST_REDIS_URL=…] npm run test:integration` | API against real MySQL/Redis, incl. tenant isolation, RBAC, CSRF, idempotency, contract validation | disposable MySQL DB                                |
| `E2E_DATABASE_URL=… npm run test:e2e`                             | Playwright: real browser, real OIDC sign-in                                                        | `npm run build`, `npx playwright install chromium` |

## Conventions

- **Contracts first**: change `packages/contracts`, then the API, then the UI. Responses are validated
  against the same schemas in integration tests and in the browser.
- **Every tenant query carries `tenantId`** from the principal. The tenant guard throws otherwise.
- **Every privileged change writes an audit event in the same transaction.**
- **Schema changes**: edit `schema.prisma`, add a migration (`prisma migrate diff --from-config-datasource
--to-schema prisma/schema.prisma --script` against your migrated dev DB), expand-only; update
  `deploy/oracle-linux/mysql/grants.sql` for new tables. CI fails if schema and migrations drift.
- **API changes**: run `npm run openapi` and commit `docs/api/openapi.json` (CI checks it).
- **UI**: semantic tokens only; every data view needs loading, empty, error and forbidden states; no
  button without a real action; no hardcoded numbers presented as data.
- **New dependency**: exact version, check license (`npm run license:check`), note why in the PR.
- Architecture decisions go in `docs/adr/`.
