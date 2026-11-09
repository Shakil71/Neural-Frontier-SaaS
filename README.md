# Neural Frontier SaaS

Next.js app. `npm run dev` for local development.

## Deployment

Every push to `main` runs `.github/workflows/ci-cd.yml`:

1. **CI** (GitHub-hosted `ubuntu-latest`): lint, build, typecheck. Also runs on PRs.
2. **Deploy** (self-hosted runner `neural-frontier` on the VPS, `main` only):
   builds, copies to `/opt/neural-frontier/releases/<timestamp>-<sha>`, repoints
   `/opt/neural-frontier/current`, restarts `neural-frontier-web.service`, then waits for
   `/api/health` to report the new commit. It rolls back to the previous release if the check fails.

| Item | Value |
|---|---|
| App user | `neural` (owns app + runner) |
| App (internal) | `127.0.0.1:3200` |
| Public (Nginx) | `:8280` — `/etc/nginx/conf.d/neural-frontier.conf` |
| Runtime env | `/opt/neural-frontier/shared/env/web.env` |
| Logs | `journalctl -u neural-frontier-web -f` |
| Runner | `/home/neural/actions-runner` (service `actions.runner.*neural-frontier*`) |

Never change `deploy` to run on `pull_request`. The repo is public, and fork PRs must not run on the VPS runner.
