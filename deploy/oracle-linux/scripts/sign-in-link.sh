#!/usr/bin/env bash
# Neural Frontier — break-glass: a one-time link to set or reset someone's password.
# Run as root on the server when nobody who could do it from the Admin Center can sign in
# (a fresh install without single sign-on, or a locked-out owner).
#
#   sudo /usr/local/lib/neural-frontier/sign-in-link.sh owner@example.com "Owner locked out, ticket 123"
#
# Runs the API's own command (dist/cli.js) as the app user with the API's configuration, through
# systemd so api.env is parsed exactly as the service parses it. Audited as `system:operator`.
set -euo pipefail
SCRIPT_NAME=sign-in-link
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need_root

[[ $# -ge 2 ]] || die 'usage: sign-in-link.sh <email> "<reason>"'
[[ -f "$CURRENT/apps/api/dist/cli.js" ]] || die "the current release has no dist/cli.js (deploy a newer release)"

exec systemd-run --quiet --wait --pipe --collect \
  --uid="$APP_USER" --gid="$APP_USER" \
  --working-directory="$CURRENT/apps/api" \
  -p EnvironmentFile="$CONF_DIR/api.env" \
  /usr/bin/node dist/cli.js sign-in-link "$1" "${*:2}"
