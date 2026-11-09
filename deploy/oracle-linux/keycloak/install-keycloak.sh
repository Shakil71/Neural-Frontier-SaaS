#!/usr/bin/env bash
# Self-hosted identity provider for Neural Frontier: Keycloak (Apache-2.0) behind the existing
# Nginx site at https://<host>:8643/auth. Run as root. Idempotent.
#
#   install-keycloak.sh --public-url https://192.168.197.100:8643 \
#     --owner-email you@example.com --owner-first "Ada" --owner-last "Lovelace"
#
# - Java 21 is installed alongside any existing Java; the system default is not changed.
# - Keycloak listens on 127.0.0.1:8481 (HTTP) and 127.0.0.1:8482 (management/health) only.
# - Realm `neural-frontier`: no self-registration, brute-force protection, login by email,
#   confidential client with PKCE S256. The owner gets a temporary password and must set a
#   new one and enrol an authenticator app (TOTP) on first sign-in.
# - Writes NF_OIDC_* into /etc/neural-frontier/api.env and restarts the API.
set -euo pipefail
SCRIPT_NAME=install-keycloak
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../scripts/lib.sh
source "$HERE/../scripts/lib.sh"
need_root

KC_VERSION=26.8.2
KC_HOME=/opt/keycloak
KC_USER=keycloak
KC_CONF_DIR=/etc/keycloak
REALM=neural-frontier
CLIENT_ID=neural-frontier
PUBLIC_URL="" OWNER_EMAIL="" OWNER_FIRST="" OWNER_LAST=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --public-url) PUBLIC_URL=$2; shift 2 ;;
    --owner-email) OWNER_EMAIL=$2; shift 2 ;;
    --owner-first) OWNER_FIRST=$2; shift 2 ;;
    --owner-last) OWNER_LAST=$2; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done
[[ -n $PUBLIC_URL && -n $OWNER_EMAIL && -n $OWNER_FIRST && -n $OWNER_LAST ]] || die "missing arguments"
ISSUER="${PUBLIC_URL}/auth/realms/${REALM}"
rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

log "Java 21 (side by side)"
rpm -q java-21-openjdk-headless >/dev/null || dnf -y -q install java-21-openjdk-headless
JAVA_HOME=$(dirname "$(dirname "$(readlink -f "$(rpm -ql java-21-openjdk-headless | grep -m1 '/bin/java$')")")")
[[ -x "$JAVA_HOME/bin/java" ]] || die "could not locate Java 21"

log "Keycloak ${KC_VERSION}"
id "$KC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$KC_HOME" --shell /sbin/nologin "$KC_USER"
if [[ ! -d "/opt/keycloak-${KC_VERSION}" ]]; then
  tmp=$(mktemp -d)
  base="https://github.com/keycloak/keycloak/releases/download/${KC_VERSION}/keycloak-${KC_VERSION}.tar.gz"
  curl -fsSL -o "$tmp/kc.tgz" "$base"
  curl -fsSL -o "$tmp/kc.tgz.sha1" "${base}.sha1"
  echo "$(cut -d' ' -f1 "$tmp/kc.tgz.sha1")  $tmp/kc.tgz" | sha1sum -c --quiet || die "Keycloak checksum mismatch"
  tar -xzf "$tmp/kc.tgz" -C /opt
  rm -rf "$tmp"
fi
ln -sfn "/opt/keycloak-${KC_VERSION}" "$KC_HOME"
chown -R root:root "/opt/keycloak-${KC_VERSION}"
install -d -o "$KC_USER" -g "$KC_USER" -m 0750 "$KC_HOME/data"

log "secrets"
install -d -o root -g "$KC_USER" -m 0750 "$KC_CONF_DIR"
SECRETS="$KC_CONF_DIR/secrets.env"
if [[ ! -f $SECRETS ]]; then
  (umask 077; printf 'KC_DB_PASSWORD=%s\nKC_ADMIN_PASSWORD=%s\n' "$(rand 40)" "$(rand 24)" >"$SECRETS")
fi
DB_PW=$(env_get "$SECRETS" KC_DB_PASSWORD)
ADMIN_PW=$(env_get "$SECRETS" KC_ADMIN_PASSWORD)

log "MySQL database"
mysql --protocol=socket <<SQL
CREATE DATABASE IF NOT EXISTS keycloak CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'keycloak'@'127.0.0.1' IDENTIFIED BY '${DB_PW}';
ALTER USER 'keycloak'@'127.0.0.1' IDENTIFIED BY '${DB_PW}';
GRANT ALL PRIVILEGES ON keycloak.* TO 'keycloak'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

log "configuration"
cat >"$KC_HOME/conf/keycloak.conf" <<EOF
db=mysql
db-url=jdbc:mysql://127.0.0.1:3306/keycloak?characterEncoding=UTF-8&allowPublicKeyRetrieval=true&useSSL=false
db-username=keycloak
http-enabled=true
http-host=127.0.0.1
http-port=8481
http-management-port=8482
http-relative-path=/auth
hostname=${PUBLIC_URL}/auth
proxy-headers=xforwarded
health-enabled=true
metrics-enabled=false
EOF
cat >"$KC_CONF_DIR/keycloak.env" <<EOF
JAVA_HOME=${JAVA_HOME}
KC_DB_PASSWORD=${DB_PW}
KC_BOOTSTRAP_ADMIN_USERNAME=admin
KC_BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PW}
JAVA_OPTS_KC_HEAP=-Xms256m -Xmx1024m
EOF
chown root:"$KC_USER" "$KC_CONF_DIR/keycloak.env"
chmod 0640 "$KC_CONF_DIR/keycloak.env"

log "build (optimised)"
JAVA_HOME="$JAVA_HOME" "$KC_HOME/bin/kc.sh" build >/dev/null
chown -R "$KC_USER":"$KC_USER" "$KC_HOME/data"
[[ -d "$KC_HOME/lib/quarkus" ]] && chown -R root:root "$KC_HOME/lib/quarkus"

log "systemd unit"
install -o root -g root -m 0644 "$HERE/neural-frontier-keycloak.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now neural-frontier-keycloak.service >/dev/null 2>&1
wait_for "http://127.0.0.1:8482/auth/health/ready" "UP" 90 || die "Keycloak did not become ready (journalctl -u neural-frontier-keycloak)"

log "realm, client and owner account"
KCADM="$KC_HOME/bin/kcadm.sh"
export JAVA_HOME
CFG=$(mktemp)
trap 'rm -f "$CFG"' EXIT
$KCADM config credentials --config "$CFG" --server http://127.0.0.1:8481/auth --realm master --user admin --password "$ADMIN_PW" >/dev/null
kc() { $KCADM "$@" --config "$CFG"; }

if ! kc get "realms/$REALM" >/dev/null 2>&1; then
  kc create realms -s realm="$REALM" -s enabled=true -s displayName="Neural Frontier" \
    -s loginWithEmailAllowed=true -s duplicateEmailsAllowed=false -s registrationAllowed=false \
    -s resetPasswordAllowed=false -s rememberMe=false -s bruteForceProtected=true \
    -s permanentLockout=false -s failureFactor=8 -s sslRequired=external \
    -s 'passwordPolicy=length(12) and notUsername and notEmail' \
    -s ssoSessionIdleTimeout=1800 -s ssoSessionMaxLifespan=43200
fi

CID=$(kc get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id --format csv --noquotes | head -n1)
if [[ -z $CID ]]; then
  kc create clients -r "$REALM" -s clientId="$CLIENT_ID" -s name="Neural Frontier Admin Center" \
    -s enabled=true -s protocol=openid-connect -s publicClient=false -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false -s implicitFlowEnabled=false -s serviceAccountsEnabled=false \
    -s "redirectUris=[\"${PUBLIC_URL}/api/v1/auth/callback\"]" -s "webOrigins=[\"${PUBLIC_URL}\"]" \
    -s "attributes={\"pkce.code.challenge.method\":\"S256\",\"post.logout.redirect.uris\":\"${PUBLIC_URL}/sign-in\"}" >/dev/null
  CID=$(kc get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id --format csv --noquotes | head -n1)
fi
CLIENT_SECRET=$(kc get "clients/$CID/client-secret" -r "$REALM" --fields value --format csv --noquotes)

TEMP_PW=""
if [[ -z $(kc get users -r "$REALM" -q email="$OWNER_EMAIL" -q exact=true --fields id --format csv --noquotes) ]]; then
  kc create users -r "$REALM" -s username="$OWNER_EMAIL" -s email="$OWNER_EMAIL" -s emailVerified=true \
    -s firstName="$OWNER_FIRST" -s lastName="$OWNER_LAST" -s enabled=true \
    -s 'requiredActions=["UPDATE_PASSWORD","CONFIGURE_TOTP"]' >/dev/null
  TEMP_PW="Nf-$(rand 14)"
  kc set-password -r "$REALM" --username "$OWNER_EMAIL" --new-password "$TEMP_PW" --temporary
fi

log "connecting Neural Frontier API to the realm"
API_ENV="$CONF_DIR/api.env"
set_env() { if grep -qE "^$1=" "$API_ENV"; then sed -i "s|^$1=.*|$1=$2|" "$API_ENV"; else printf '%s=%s\n' "$1" "$2" >>"$API_ENV"; fi; }
set_env NF_OIDC_ISSUER "$ISSUER"
set_env NF_OIDC_CLIENT_ID "$CLIENT_ID"
set_env NF_OIDC_CLIENT_SECRET "$CLIENT_SECRET"
# The API discovers the issuer over HTTPS; trust the host's self-signed certificate.
set_env NODE_EXTRA_CA_CERTS /etc/pki/tls/neural-frontier/selfsigned.crt
systemctl restart "$API_UNIT"
wait_for "http://127.0.0.1:${API_PORT}/api/health/ready" "" 30 || die "API did not restart cleanly"

log "login theme"
bash "$HERE/install-theme.sh" "$REALM" master

log "done. Issuer: $ISSUER"
log "Keycloak admin console (private networks only): ${PUBLIC_URL}/auth/admin/  user 'admin', password in $SECRETS"
if [[ -n $TEMP_PW ]]; then
  log "Owner ${OWNER_EMAIL} temporary password: ${TEMP_PW}  (must be changed at first sign-in, plus authenticator setup)"
fi
