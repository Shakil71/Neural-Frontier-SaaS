#!/usr/bin/env bash
# Neural Frontier — one-time host provisioning for Oracle Linux 9. Run as root. Idempotent.
#
#   sudo deploy/oracle-linux/scripts/install.sh [--public-url https://HOST:8643]
#
# Creates directories, secrets, the MySQL database and least-privilege users, a Redis ACL user,
# a self-signed TLS certificate, SELinux/firewalld rules, systemd units, the deploy sudoers
# rule, the Nginx site and the backup timer. Existing secrets are never overwritten.
# Touches nothing that belongs to other applications on the host.
set -euo pipefail
SCRIPT_NAME=install
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="$(dirname "$HERE")"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need_root

PUBLIC_URL=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --public-url) PUBLIC_URL=$2; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done
PUBLIC_URL=${PUBLIC_URL:-"https://$(hostname -I | awk '{print $1}'):${HTTPS_PORT}"}

grep -q 'VERSION_ID="9' /etc/os-release || die "this kit targets Oracle Linux / RHEL 9"
command -v node >/dev/null || die "node is not installed"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' \
  || die "Node.js >= 22.12 required (found $(node -v))"
command -v rsync >/dev/null || dnf -y -q install rsync
for bin in mysql mysqldump redis-cli nginx openssl semanage firewall-cmd rsync; do
  command -v "$bin" >/dev/null || die "missing required tool: $bin"
done

rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

log "directories"
id "$APP_USER" >/dev/null 2>&1 || { useradd --create-home --shell /bin/bash "$APP_USER"; passwd -l "$APP_USER" >/dev/null; }
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_ROOT" "$RELEASES"
install -d -o root -g "$APP_USER" -m 0750 "$CONF_DIR"
install -d -o root -g root -m 0700 "$BACKUP_DIR"
install -d -o root -g root -m 0755 "$STATE_DIR" "$ROOT_LIB"

log "secrets (generated once, never overwritten)"
SECRETS="$CONF_DIR/secrets.env"
if [[ ! -f $SECRETS ]]; then
  umask 077
  cat >"$SECRETS" <<EOF
NF_APP_DB_PASSWORD=$(rand 40)
NF_MIGRATE_DB_PASSWORD=$(rand 40)
NF_REDIS_PASSWORD=$(rand 40)
NF_SESSION_SECRET=$(rand 64)
EOF
  chmod 0600 "$SECRETS"
fi
[[ -f "$CONF_DIR/backup.key" ]] || { (umask 077; openssl rand -base64 64 >"$CONF_DIR/backup.key"); }
chmod 0600 "$CONF_DIR/backup.key"
APP_PW=$(env_get "$SECRETS" NF_APP_DB_PASSWORD)
MIGRATE_PW=$(env_get "$SECRETS" NF_MIGRATE_DB_PASSWORD)
REDIS_PW=$(env_get "$SECRETS" NF_REDIS_PASSWORD)
SESSION_SECRET=$(env_get "$SECRETS" NF_SESSION_SECRET)

log "MySQL database and users"
sed -e "s/__NF_APP_PASSWORD__/${APP_PW}/g" -e "s/__NF_MIGRATE_PASSWORD__/${MIGRATE_PW}/g" \
  "$KIT/mysql/provision.sql" | mysql --protocol=socket

log "Redis ACL user (keys nf:* only)"
REDIS_CONF=/etc/redis/redis.conf
REDIS_ADMIN_PW=$(awk '$1=="requirepass"{gsub(/"/,"",$2);print $2}' "$REDIS_CONF")
ACL_RULE="on >${REDIS_PW} ~nf:* resetchannels -@all +@read +@write +@string +@hash +@list +@set +@sortedset +@keyspace +@scripting +@connection -@dangerous"
# shellcheck disable=SC2086
REDISCLI_AUTH="$REDIS_ADMIN_PW" redis-cli --no-auth-warning ACL SETUSER nf reset $ACL_RULE >/dev/null
if grep -qE '^aclfile' "$REDIS_CONF"; then
  REDISCLI_AUTH="$REDIS_ADMIN_PW" redis-cli --no-auth-warning ACL SAVE >/dev/null
elif ! grep -q '^user nf ' "$REDIS_CONF"; then
  cp -p "$REDIS_CONF" "$REDIS_CONF.bak-neural-frontier-$(date +%s)"
  printf '\n# Neural Frontier (added by neural-frontier install.sh)\nuser nf %s\n' "$ACL_RULE" >>"$REDIS_CONF"
fi

log "environment files"
if [[ ! -f "$CONF_DIR/api.env" ]]; then
  sed -e "s|^DATABASE_URL=.*|DATABASE_URL=mysql://nf_app:${APP_PW}@127.0.0.1:3306/${DB_NAME}?connectionLimit=20\&allowPublicKeyRetrieval=true|" \
      -e "s|^REDIS_URL=.*|REDIS_URL=redis://nf:${REDIS_PW}@127.0.0.1:6379/0|" \
      -e "s|^NF_SESSION_SECRET=.*|NF_SESSION_SECRET=${SESSION_SECRET}|" \
      -e "s|^NF_PUBLIC_URL=.*|NF_PUBLIC_URL=${PUBLIC_URL}|" \
      "$KIT/env/api.env.example" >"$CONF_DIR/api.env"
fi
[[ -f "$CONF_DIR/web.env" ]] || cp "$KIT/env/web.env.example" "$CONF_DIR/web.env"
printf 'DATABASE_URL=mysql://nf_migrate:%s@127.0.0.1:3306/%s?allowPublicKeyRetrieval=true\nNF_MIGRATE_DB_PASSWORD=%s\n' \
  "$MIGRATE_PW" "$DB_NAME" "$MIGRATE_PW" >"$CONF_DIR/migrate.env"
chown root:"$APP_USER" "$CONF_DIR"/{api,web,migrate}.env
chmod 0640 "$CONF_DIR"/{api,web,migrate}.env

log "TLS certificate (self-signed until a domain exists)"
TLS_DIR=/etc/pki/tls/neural-frontier
install -d -m 0755 "$TLS_DIR"
if [[ ! -f "$TLS_DIR/selfsigned.crt" ]]; then
  HOST_IP=$(hostname -I | awk '{print $1}')
  openssl req -x509 -newkey rsa:3072 -sha256 -days 825 -nodes \
    -keyout "$TLS_DIR/selfsigned.key" -out "$TLS_DIR/selfsigned.crt" \
    -subj "/CN=Neural Frontier" -addext "subjectAltName=IP:${HOST_IP},DNS:localhost" 2>/dev/null
  chmod 0600 "$TLS_DIR/selfsigned.key"
fi
restorecon -R "$TLS_DIR" || true

log "SELinux and firewall"
for port in "$HTTP_PORT" "$HTTPS_PORT"; do
  semanage port -l | grep -qE "^http_port_t .*\b${port}\b" || semanage port -a -t http_port_t -p tcp "$port"
  firewall-cmd --permanent --query-port="${port}/tcp" >/dev/null || firewall-cmd --permanent --add-port="${port}/tcp" >/dev/null
done
setsebool -P httpd_can_network_connect on
firewall-cmd --reload >/dev/null

log "root-owned operations scripts"
install -o root -g root -m 0755 "$HERE/lib.sh" "$HERE/backup.sh" "$HERE/restore-test.sh" "$HERE/validate.sh" "$ROOT_LIB/"

log "systemd units"
install -o root -g root -m 0644 "$KIT"/systemd/neural-frontier-{api,web,backup}.service "$KIT/systemd/neural-frontier-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$API_UNIT" "$WEB_UNIT" >/dev/null 2>&1
systemctl enable --now neural-frontier-backup.timer >/dev/null 2>&1

log "deploy sudoers rule"
cat >/etc/sudoers.d/neural-frontier-deploy <<EOF
# Neural Frontier deploy: the runner (user ${APP_USER}) may only restart/inspect its own units.
Cmnd_Alias NF_UNITS = /usr/bin/systemctl restart ${API_UNIT}, \\
                      /usr/bin/systemctl restart ${WEB_UNIT}, \\
                      /usr/bin/systemctl is-active ${API_UNIT}, \\
                      /usr/bin/systemctl is-active ${WEB_UNIT}
${APP_USER} ALL=(root) NOPASSWD: NF_UNITS
EOF
chmod 0440 /etc/sudoers.d/neural-frontier-deploy
visudo -cf /etc/sudoers.d/neural-frontier-deploy >/dev/null
rm -f /etc/sudoers.d/neural-frontier   # superseded placeholder rule, if present

log "nginx site"
install -o root -g root -m 0644 "$KIT/nginx/neural-frontier.conf" /etc/nginx/conf.d/neural-frontier.conf
nginx -t 2>&1 | tail -n1
systemctl reload nginx

log "done. Next: run the 'Deploy' workflow, then: sudo ${ROOT_LIB}/validate.sh"
log "Public URL: ${PUBLIC_URL}   (secrets: ${SECRETS}, root-only)"
