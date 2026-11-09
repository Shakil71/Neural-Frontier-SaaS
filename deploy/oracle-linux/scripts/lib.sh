#!/usr/bin/env bash
# Shared settings and helpers for Neural Frontier operations scripts.
# shellcheck disable=SC2034  # variables are used by the sourcing scripts

APP_USER="neural"
APP_ROOT="/license_monitoring/neural-frontier"
RELEASES="${APP_ROOT}/releases"
CURRENT="${APP_ROOT}/current"
CONF_DIR="/etc/neural-frontier"
BACKUP_DIR="/databackup/neural-frontier"
STATE_DIR="/var/lib/neural-frontier"
ROOT_LIB="/usr/local/lib/neural-frontier"
DB_NAME="neural_frontier"
API_UNIT="neural-frontier-api.service"
WEB_UNIT="neural-frontier-web.service"
WORKER_UNIT="neural-frontier-worker.service"
API_PORT=3401
WEB_PORT=3400
HTTPS_PORT=8643
HTTP_PORT=8280
KEEP_RELEASES=5

log() { printf '%s [%s] %s\n' "$(date -u +%FT%TZ)" "${SCRIPT_NAME:-nf}" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
need_root() { [[ ${EUID} -eq 0 ]] || die "must run as root"; }
need_user() { [[ "$(id -un)" == "$1" ]] || die "must run as $1 (currently $(id -un))"; }

# Reads KEY from an env file without sourcing it (values may contain shell metacharacters).
env_get() {
  local file=$1 key=$2
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2-
}

# Lists entries of DIR matching GLOB, newest first, one path per line (no `ls` parsing).
newest_first() {
  find "$1" -mindepth 1 -maxdepth 1 -name "$2" -printf '%T@\t%p\n' | sort -rn | cut -f2-
}

# Polls a URL until it returns 2xx (and optionally contains a string).
wait_for() {
  local url=$1 expect=${2:-} tries=${3:-30} body
  for ((i = 1; i <= tries; i++)); do
    if body=$(curl -fsS --max-time 3 -k "$url" 2>/dev/null); then
      if [[ -z $expect || $body == *"$expect"* ]]; then return 0; fi
    fi
    sleep 2
  done
  return 1
}
