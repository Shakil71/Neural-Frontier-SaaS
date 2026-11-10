#!/usr/bin/env bash
# Neural Frontier — stop depending on the shared Keycloak (Phase 3c-3). Run as root.
#
#   sudo /usr/local/lib/neural-frontier/retire-keycloak.sh          # check, then switch
#   sudo /usr/local/lib/neural-frontier/retire-keycloak.sh --check  # only report readiness
#   sudo /usr/local/lib/neural-frontier/retire-keycloak.sh --undo   # bring Keycloak back
#
# Refuses to switch while any active organisation would be locked out: each one needs its own
# identity provider, or an active owner with a built-in password and password sign-in allowed.
# Switching removes the NF_OIDC_* settings from api.env (a backup is kept), restarts the API and
# stops (does not delete) Keycloak. --undo restores the backup and starts Keycloak again.
set -euo pipefail
SCRIPT_NAME=retire-keycloak
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need_root

KEYCLOAK_UNIT=neural-frontier-keycloak.service
API_ENV="$CONF_DIR/api.env"
MODE=${1:-switch}

restart_api() {
  systemctl restart "$API_UNIT"
  wait_for "http://127.0.0.1:${API_PORT}/api/health/ready" "" 30 || die "the API did not become ready; check: journalctl -u $API_UNIT"
}

if [[ $MODE == --undo ]]; then
  backup=$(newest_first "$CONF_DIR" "api.env.bak-keycloak-*" | head -n1)
  [[ -n $backup ]] || die "no api.env backup from a previous switch was found"
  cp -p "$backup" "$API_ENV"
  systemctl enable --now "$KEYCLOAK_UNIT" >/dev/null 2>&1 || log "WARNING: could not start $KEYCLOAK_UNIT"
  restart_api
  log "restored $(basename "$backup"); Keycloak and shared single sign-on are back"
  exit 0
fi

if ! grep -qE '^NF_OIDC_ISSUER=.+' "$API_ENV"; then
  log "shared single sign-on is already off (NF_OIDC_ISSUER is empty)"
  exit 0
fi

log "checking that no organisation would be locked out"
# Active organisations that have neither their own identity provider nor an active owner who can
# sign in with a built-in password (and is allowed to).
BLOCKED=$(mysql --protocol=socket -N -B "$DB_NAME" <<'SQL'
SELECT t.slug FROM tenants t
WHERE t.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM tenant_identity_providers p WHERE p.tenantId = t.id)
  AND (
    EXISTS (SELECT 1 FROM tenant_sign_in_policies s WHERE s.tenantId = t.id AND s.passwordSignIn = 0)
    OR NOT EXISTS (
      SELECT 1 FROM identities i
      JOIN role_assignments ra ON ra.identityId = i.id
      JOIN roles r ON r.id = ra.roleId AND r.`key` = 'owner'
      JOIN local_credentials c ON c.identityId = i.id AND c.passwordHash IS NOT NULL
      WHERE i.tenantId = t.id AND i.status = 'active'
    )
  );
SQL
)
if [[ -n $BLOCKED ]]; then
  log "NOT READY. These organisations would lose access:"
  # shellcheck disable=SC2086 # one organisation slug per word, by design
  printf '  - %s\n' $BLOCKED
  log "An owner of each must add a password (My account → Security & sign-in), with password"
  log "sign-in allowed in Organisation → Built-in sign-in. Nothing was changed."
  exit 1
fi
log "ready: every active organisation keeps a way in"
[[ $MODE == --check ]] && exit 0

backup="$API_ENV.bak-keycloak-$(date +%Y%m%d%H%M%S)"
cp -p "$API_ENV" "$backup"
chmod 0640 "$backup"
sed -i -E 's/^(NF_OIDC_ISSUER|NF_OIDC_CLIENT_ID|NF_OIDC_CLIENT_SECRET)=.*/\1=/' "$API_ENV"
log "removed the shared provider from api.env (backup: $(basename "$backup"))"
restart_api
if systemctl cat "$KEYCLOAK_UNIT" >/dev/null 2>&1; then
  systemctl disable --now "$KEYCLOAK_UNIT" >/dev/null 2>&1
  log "stopped and disabled $KEYCLOAK_UNIT (its data is kept; --undo brings it back)"
fi
log "done: sign-in is now fully built in. Organisations with their own provider are unaffected."
