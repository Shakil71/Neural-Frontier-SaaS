#!/usr/bin/env bash
# Neural Frontier — roll back to a previous release. Runs as `neural`.
#
#   rollback.sh              # previous release (second newest)
#   rollback.sh <release-id> # a specific kept release
#
# Database migrations are expand-only (see docs/adr/0006-deployment.md), so the previous
# application release keeps working against the newer schema.
set -euo pipefail
SCRIPT_NAME=rollback
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need_user "$APP_USER"

CURRENT_ID=$(basename "$(readlink -f "$CURRENT")")
if [[ $# -ge 1 ]]; then
  TARGET_ID=$1
else
  TARGET_ID=$(newest_first "$RELEASES" '*' | xargs -r -n1 basename | grep -vx "$CURRENT_ID" | head -n1 || true)
fi
[[ -n ${TARGET_ID:-} && -d "$RELEASES/$TARGET_ID" ]] || die "no release to roll back to"
[[ $TARGET_ID != "$CURRENT_ID" ]] || die "$TARGET_ID is already current"

log "switching $CURRENT_ID -> $TARGET_ID"
ln -sfn "$RELEASES/$TARGET_ID" "$CURRENT.next" && mv -T "$CURRENT.next" "$CURRENT"
sudo /usr/bin/systemctl restart "$API_UNIT"
sudo /usr/bin/systemctl restart "$WEB_UNIT"

if wait_for "http://127.0.0.1:${API_PORT}/api/health/ready" "\"release\":\"${TARGET_ID}\"" 30 \
  && wait_for "http://127.0.0.1:${WEB_PORT}/sign-in" "" 30; then
  log "rolled back to $TARGET_ID and healthy"
else
  die "release $TARGET_ID did not become healthy — investigate: journalctl -u $API_UNIT -u $WEB_UNIT"
fi
