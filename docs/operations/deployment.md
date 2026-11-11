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

## Background worker and directory connectors (Phase 2)

The worker (`neural-frontier-worker.service`, `dist/worker.js`) runs directory syncs from the MySQL
job queue (ADR 0008). It uses the same `/etc/neural-frontier/api.env`, so it needs the same settings
as the API plus `NF_DATA_KEY`. That key encrypts connector credentials. `install.sh` generates it
once into `secrets.env` and copies it to `api.env`.

**Keep a copy of `NF_DATA_KEY` with `backup.key`, off the server.** Without it, connector secrets
can't be decrypted. Nothing else is lost: re-enter each connector's client secret.

Upgrading a host installed before Phase 2 (one time, as root, from the new release):

```bash
sudo /license_monitoring/neural-frontier/current/deploy/oracle-linux/scripts/install.sh \
  --public-url https://192.168.197.100:8643
```

It is idempotent. It adds `NF_DATA_KEY`, installs and enables the worker unit, and extends the
deploy sudoers rule. Run it **before** deploying the Phase 2 release, because `deploy.sh` refuses
to run without the worker unit.

Connecting Microsoft Entra ID (Admin Center → Connectors → Connect directory):

1. Entra admin center → App registrations → New registration (single tenant).
2. API permissions → Microsoft Graph → **Application**: `User.Read.All`, `GroupMember.Read.All`
   → Grant admin consent.
3. Certificates & secrets → New client secret.
4. Enter the directory (tenant) ID, application (client) ID and secret value. Then use **Test
   connection**, then **Sync now**.

The host needs outbound HTTPS to `login.microsoftonline.com` and `graph.microsoft.com`. The System
page's **Background worker** card warns when jobs wait more than five minutes, which means the
worker isn't running: `journalctl -u neural-frontier-worker`.

Service principals (Admin Center → Service principals, Owners only) get tokens from
`POST /api/v1/oauth/token` (client credentials, form or Basic auth). Tokens are valid for 15
minutes and can only call routes opened to machines (directory, connectors read/sync, audit and
identity reads).

## Automatic provisioning (SCIM 2.0) and single sign-out (Phase 2c)

In the Admin Center, go to Organisation → Automatic provisioning → **New provisioning token**
(Owners only). Copy the **Tenant URL** (`https://<host>:8643/api/scim/v2`) and the **secret
token**; the token is shown once. In Entra ID:

1. Enterprise application → Provisioning → Automatic.
2. Paste both values, then use **Test connection**.
3. Map **users only**. Groups aren't supported yet.

`userName` must be a work email on a verified domain. New users get the Member role.
Deactivating a user in Entra ID suspends them here and ends their sessions immediately.
Deleting a user deactivates them; nobody is erased.

Signing out now also ends the identity provider's session, using RP-initiated logout with
`id_token_hint`. The provider must allow `https://<host>:8643/sign-in` as a post-logout
redirect URI. `install-keycloak.sh` already registers it for Keycloak.

## Built-in sign-in (Phase 3a)

People can sign in with a Neural Frontier password and an authenticator app, without Keycloak.
Owners choose the rules in **Organisation → Built-in sign-in**. Administrators issue set-up and
reset links from each person's **Sign-in** panel.

**Break-glass** (nobody who could issue a link can sign in, for example a fresh install without
single sign-on, or a locked-out owner). As root on the server:

```bash
sudo /usr/local/lib/neural-frontier/sign-in-link.sh owner@example.com "Owner locked out, ticket 123"
```

It prints a one-time link. It runs the API's own command with the API's configuration, and the audit
log records it as `system:operator`. Two-step sign-in needs `NF_DATA_KEY`, which `install.sh`
already generates.

## Email delivery (Phase 3b)

Each organisation connects its own mail server in **Organisation → Email delivery**, then clicks
**Send me a test**. The worker sends queued mail; if messages stay "queued", check
`systemctl status neural-frontier-worker`. A relay on this server (for example Postfix on
127.0.0.1:25) can use any port and no encryption; remote servers need STARTTLS or TLS on a mail port.
If the mail server uses a private CA, add `NF_SMTP_CA_FILE=/path/to/ca.pem` to `api.env` and restart
the API and worker.

## Applications: sign in with Neural Frontier (Phase 3c)

Administrators register apps in **Applications**. Apps need only the issuer
(`https://<host>:8643/api/oidc`): discovery provides the rest. Behind a self-signed certificate,
apps must trust `/etc/pki/tls/neural-frontier/selfsigned.crt`. With a domain and a real certificate
they work out of the box. The token signing key is created on first use and sealed with
`NF_DATA_KEY`: keep that key backed up, like the database.

## Retiring Keycloak (Phase 3c-3)

Built-in sign-in (3a) replaces the shared Keycloak. Steps:

1. Each owner adds a password: **My account → Security & sign-in** (needs a fresh sign-in).
   **Organisation → Built-in sign-in** shows how many owners and people are ready.
2. Check: `sudo /usr/local/lib/neural-frontier/retire-keycloak.sh --check`. It lists every
   organisation that would lose access, and changes nothing.
3. Switch: `sudo /usr/local/lib/neural-frontier/retire-keycloak.sh`. It refuses while anyone would
   be locked out. It then backs up `api.env`, clears the `NF_OIDC_*` settings, restarts the API,
   and stops and disables Keycloak (its data is kept).
4. Undo at any time: `sudo /usr/local/lib/neural-frontier/retire-keycloak.sh --undo`.

Organisations that connected their own identity provider (Organisation → Single sign-on) are
unaffected. After the switch, the sign-in screen no longer offers the shared single sign-on.

## Network exposure (Phase 4a)

Agents from this release also report listening ports, the host firewall (firewalld through
`firewall-cmd`, ufw from its rule files) and the effective `sshd_config`. The Admin Center turns
that into findings: **Infrastructure → Exposure**, and a **Security** tab on each server.

- **Updating agents.** Agents don't update themselves. On each server, run the install command
  again (Servers → Add server issues a key): it replaces the binary and re-enrols the same machine,
  which rotates its token. Until then the server shows "No exposure data from this server yet".
- **What the agent can't see.** It runs without capabilities, so raw nftables/iptables rules
  (they need `CAP_NET_ADMIN`) are reported as "running; rules not readable", and the process
  behind most sockets is unknown (only the owning user is shown). Cloud security groups,
  upstream firewalls and Docker-published ports are outside the analysis.
- **Accepting a finding** needs `servers.manage` and a reason, and is audited. Accepted findings
  stay visible and can be reopened.

## Patch compliance (Phase 4b)

Agents from this release also report pending updates, security advisories (with severity on
RHEL-family systems) and whether a reboot is needed: **Infrastructure → Updates**, and an
**Updates** tab on each server. Update findings join the others on **Security findings**
(formerly Exposure; the old address redirects).

- The agent asks dnf or apt **from the local cache only**, at most hourly. Freshness depends on
  the system's own timers (`dnf-makecache.timer`, apt's daily update). Package information 7+
  days old is reported as a finding.
- The agent unit gains `ReadWritePaths=-/var/cache/dnf`, because dnf takes a lock there even in
  cache-only mode. Re-running the install command on each server installs the new binary and the
  updated unit.

## Windows computers and servers (Phase 4c)

The same agent runs on Windows 10/11 and Windows Server 2016 or later. `deploy.sh` builds
`nf-agent-windows-{amd64,arm64}.exe` with the Linux builds (Go is already required).

- **Adding one.** Servers → Add server → create a key → **Windows** tab. Run the command in
  PowerShell opened as Administrator. It downloads `install.ps1`, verifies the agent's SHA-256,
  installs it to `C:\Program Files\Neural Frontier`, stores the credential in
  `%ProgramData%\NeuralFrontier` (SYSTEM and Administrators only), enrols, and starts the
  `nf-agent` service (automatic, restarts on failure).
- **Reaching the server.** The computer must reach the public URL (port 8643 today). TLS 1.2 is
  required, which nginx allows. With the self-signed certificate, the command trusts only that
  exact certificate.
- **Logs and status.** `Get-Service nf-agent`, and `%ProgramData%\NeuralFrontier\agent.log`
  (rolled over at 1 MB).
- **Upgrading.** Run a new command; it stops the service, replaces the program and re-enrols.
- **Removing.** `Stop-Service nf-agent; sc.exe delete nf-agent`, then delete
  `C:\Program Files\Neural Frontier` and `%ProgramData%\NeuralFrontier`, and retire the computer
  in the Admin Center.

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
