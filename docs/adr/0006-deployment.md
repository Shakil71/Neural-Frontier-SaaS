# ADR-0006: Deployment on Oracle Linux 9 without containers

- Status: Accepted · 2026-11-09

## Context

The initial host is a shared production VPS (Oracle Linux 9.8, SELinux enforcing, firewalld) that also
runs other applications, MySQL 8.4, Redis 7.2 and Nginx. Docker is not available and must not be added.

## Decision

- **Paths**: releases under `/license_monitoring/neural-frontier` (the operator's chosen 100 GB volume,
  instead of the directive's suggested `/opt`), config in `/etc/neural-frontier`, encrypted backups in
  `/databackup/neural-frontier`, state in `/var/lib/neural-frontier`, logs in journald.
- **Ports** (all loopback): web 3400, API 3401, connector gateway 3402 (reserved). Public: HTTPS 8643,
  HTTP 8280 → redirect. 443/80 belong to other applications on this host.
- **Processes**: hardened systemd units (`ProtectSystem=strict`, no capabilities, read-only release tree).
- **Releases**: immutable directories `releases/<UTC timestamp>-<sha>`; `current` symlink switched
  atomically; last 5 kept.
- **Migrations are expand-only** (add columns/tables/indexes; destructive changes happen in a later
  release once no running code uses the old shape). Therefore rollback = switch the symlink back; there
  are no down-migrations.
- **Least privilege**: runtime DB user has per-table DML, append-only on `audit_events`; a separate
  migration user; Redis ACL user limited to `nf:*`; the deploy user may only restart its own two units.
- **CI/CD**: CI on GitHub-hosted runners for every push and PR. Deployment is a manual workflow on the
  self-hosted runner, only for `main`, only after CI passed for that commit, gated by the `production`
  environment's required reviewers. Builds happen on the production OS from the lockfile; the release
  tarball gets a Sigstore-signed build-provenance attestation.
- **Backups**: daily encrypted `mysqldump` (AES-256, PBKDF2 key), 14-day retention, weekly automated
  restore test into a throw-away database.

## Consequences

- Moving to Kubernetes later changes the packaging, not the application: config is environment-only,
  processes are stateless, health endpoints exist.
- Until a domain exists the certificate is self-signed, so browsers warn and HSTS is off.
