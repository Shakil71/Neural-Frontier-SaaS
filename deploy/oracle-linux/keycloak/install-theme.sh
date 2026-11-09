#!/usr/bin/env bash
# Installs the Neural Frontier login theme into Keycloak and makes it the login theme of the
# given realms. Run as root. Idempotent; restarts Keycloak (sign-in pauses for ~30 s).
#
#   install-theme.sh [realm ...]      # default: neural-frontier master
set -euo pipefail
SCRIPT_NAME=install-theme
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../scripts/lib.sh
source "$HERE/../scripts/lib.sh"
need_root

KC_HOME=/opt/keycloak
UNIT=neural-frontier-keycloak.service
REALMS=("$@")
[[ ${#REALMS[@]} -gt 0 ]] || REALMS=(neural-frontier master)
for r in "${REALMS[@]}"; do [[ $r =~ ^[A-Za-z0-9_-]+$ ]] || die "invalid realm name: $r"; done

log "copying theme"
rm -rf "$KC_HOME/themes/neural-frontier"
cp -r "$HERE/themes/neural-frontier" "$KC_HOME/themes/"
chown -R root:root "$KC_HOME/themes/neural-frontier"
chmod -R a+rX,go-w "$KC_HOME/themes/neural-frontier"

log "selecting it for: ${REALMS[*]}"
in_list=$(printf "'%s'," "${REALMS[@]}")
mysql --protocol=socket -e "UPDATE keycloak.REALM SET LOGIN_THEME='neural-frontier' WHERE NAME IN (${in_list%,});"

log "restarting Keycloak"
systemctl stop "$UNIT"
# Keycloak keeps gzip copies of theme resources under a version path that doesn't change when a
# theme does; clear them so browsers get the new files.
rm -rf "$KC_HOME/data/tmp/kc-gzip-cache"
systemctl start "$UNIT"
wait_for "http://127.0.0.1:8482/auth/health/ready" "UP" 90 || die "Keycloak did not become ready (journalctl -u $UNIT)"
log "done"
