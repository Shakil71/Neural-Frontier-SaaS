# Deployment runbook — Oracle Linux 9 VPS

Host: `192.168.197.100` (Oracle Linux 9.8, SELinux enforcing, firewalld). **Shared with other production
applications** — every step below touches only Neural Frontier's own user, units, ports, database,
Redis keys and Nginx site.

|                  | Value                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Releases         | `/license_monitoring/neural-frontier/releases/<UTC-timestamp>-<sha>`, `current` symlink                        |
| Config & secrets | `/etc/neural-frontier/{api,web,migrate}.env` (root:neural 0640), `secrets.env`, `backup.key` (root 0600)       |
| Backups          | `/databackup/neural-frontier` (root 0700), daily 02:30, 14-day retention, weekly restore test                  |
| Services         | `neural-frontier-api` (127.0.0.1:3401), `neural-frontier-web` (127.0.0.1:3400), `neural-frontier-backup.timer` |
| Public           | `https://<host>:8643` (self-signed), `http://<host>:8280` → redirect                                           |
| Database         | `neural_frontier`; users `nf_app` (runtime, append-only audit) and `nf_migrate`                                |
| Redis            | ACL user `nf`, keys `nf:*` only                                                                                |
| Runner           | `/home/neural/actions-runner`, labels `self-hosted, neural-frontier`                                           |
| Logs             | `journalctl -u neural-frontier-api -u neural-frontier-web -f`                                                  |

## 0. GitHub settings (once, in the browser)

1. **Settings → Environments → New environment `production`** → _Required reviewers_: yourself (and a
   second person when available). _Deployment branches_: `main` only.
2. **Settings → Branches → Add rule for `main`**: require a pull request with 1 approval; require status
   checks **CI passed** and **Static analysis (JavaScript/TypeScript)**; require branches up to date;
   block force pushes.
3. **Settings → Actions → General → Fork pull request workflows**: _Require approval for all outside
   collaborators_.
4. **Settings → Code security**: enable Dependabot alerts, secret scanning and push protection.

## 1. First-time host provisioning (needs root; changes the host)

```bash
git clone https://github.com/Shakil71/Neural-Frontier-SaaS.git /root/neural-frontier-kit
cd /root/neural-frontier-kit
sudo deploy/oracle-linux/scripts/install.sh --public-url https://192.168.197.100:8643
```

It creates the database and users (random passwords stored in `secrets.env`), the Redis ACL user
(appends one `user nf …` line to `/etc/redis/redis.conf` after backing it up, when no `aclfile` is used),
the TLS certificate, SELinux port labels and firewall rules for 8280/8643, the systemd units, the sudoers
rule and the Nginx site, and enables the backup timer.

**Cut-over note:** `install.sh` replaces the placeholder Next.js unit (port 3200) and the placeholder Nginx
site on 8280. Run the Deploy workflow immediately afterwards; until it finishes, 8643 returns 502.

## 2. Configure single sign-on

Register an OIDC web application at the chosen IdP with redirect URI
`https://<host>:8643/api/v1/auth/callback`, scopes `openid email profile`. Then set in
`/etc/neural-frontier/api.env`: `NF_OIDC_ISSUER`, `NF_OIDC_CLIENT_ID`, `NF_OIDC_CLIENT_SECRET`
(and `NF_OIDC_REQUIRE_EMAIL_VERIFIED=false` only for IdPs such as Entra ID that omit the claim and are
authoritative for the domain). `sudo systemctl restart neural-frontier-api`.

### Self-hosted option (in use on this VPS): Keycloak

```bash
sudo deploy/oracle-linux/keycloak/install-keycloak.sh --public-url https://192.168.197.100:8643   --owner-email you@example.com --owner-first "First" --owner-last "Last"
```

Installs Keycloak 26.8.2 (Java 21 side by side, loopback :8481/:8482, MySQL database `keycloak`), serves it at
`/auth`, creates realm `neural-frontier` and a confidential PKCE client, creates the owner with a temporary
password (must be changed, plus authenticator-app enrolment, at first sign-in) and writes `NF_OIDC_*` into
`api.env`. Admin console: `https://<host>:8643/auth/admin/` from private networks only; the `admin` password is
in `/etc/keycloak/secrets.env`. Add more people there (Users → Add user, email verified), or they are refused.

## 3. Bootstrap the first tenant (once)

```bash
cd /license_monitoring/neural-frontier/current/packages/db
sudo -u neural env $(sudo grep ^DATABASE_URL /etc/neural-frontier/api.env) \
  NF_BOOTSTRAP_TENANT_NAME="Your Company" NF_BOOTSTRAP_TENANT_SLUG=yourco \
  NF_BOOTSTRAP_DOMAIN=yourco.com NF_BOOTSTRAP_OWNER_EMAIL=you@yourco.com NF_BOOTSTRAP_OWNER_NAME="Your Name" \
  node dist/seed.js
```

The owner is linked to their IdP account on first sign-in. Everyone else from a verified domain is
provisioned as a Member (no admin access) until an Owner grants a role.

## 4. Deploy

GitHub → **Actions → Deploy → Run workflow** (branch `main`) → approve the `production` environment.
The job refuses to run unless **CI passed** succeeded for that commit. It builds on the host, signs build
provenance, runs migrations, re-applies grants, switches `current`, restarts both services and waits for
`/api/health/ready` to report the new release id — rolling back automatically if it doesn't.

## 5. Verify

```bash
sudo /usr/local/lib/neural-frontier/validate.sh
```

## Rollback

```bash
sudo -u neural /license_monitoring/neural-frontier/current/deploy/oracle-linux/scripts/rollback.sh          # previous
sudo -u neural /license_monitoring/neural-frontier/current/deploy/oracle-linux/scripts/rollback.sh <release> # specific
```

Migrations are expand-only, so older releases run on the newer schema.

## Backups

```bash
sudo systemctl start neural-frontier-backup.service      # backup now
sudo /usr/local/lib/neural-frontier/restore-test.sh      # prove the newest backup restores
cat /var/lib/neural-frontier/last-restore-test.json
```

**Keep a copy of `/etc/neural-frontier/backup.key` outside this server** (password manager / vault).
Without it, backups cannot be decrypted. Copy encrypted backups off-host as well.

## Removing Neural Frontier from the host

Stop and disable the three units, remove `/etc/systemd/system/neural-frontier-*`,
`/etc/nginx/conf.d/neural-frontier.conf`, `/etc/sudoers.d/neural-frontier-deploy`, the `user nf` line in
`redis.conf`, the `neural_frontier` database and `nf_*` users, and the 8643 firewall/SELinux entries.
