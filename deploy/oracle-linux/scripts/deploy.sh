#!/usr/bin/env bash
# Neural Frontier — release deployment. Runs as the `neural` user on the self-hosted runner.
#
#   deploy.sh <built-workspace-dir> <release-id>
#
# 1. Preflight  2. Migrate (expand-only, backward compatible) + re-apply grants
# 3. Stage an immutable release  4. Switch `current` and restart  5. Health-check the exact
# release id  6. Roll back automatically on failure  7. Keep the last 5 releases.
set -euo pipefail
SCRIPT_NAME=deploy
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need_user "$APP_USER"

SRC=${1:?usage: deploy.sh <workspace> <release-id>}
RELEASE_ID=${2:?usage: deploy.sh <workspace> <release-id>}
[[ $RELEASE_ID =~ ^[A-Za-z0-9._-]{6,64}$ ]] || die "invalid release id"
TARGET="$RELEASES/$RELEASE_ID"

log "preflight"
for bin in rsync mysql curl npx; do command -v "$bin" >/dev/null || die "missing tool: $bin (run install.sh)"; done
for f in api.env web.env migrate.env; do
  [[ -r "$CONF_DIR/$f" ]] || die "$CONF_DIR/$f missing — run install.sh on the host first"
done
for u in "$API_UNIT" "$WEB_UNIT" "$WORKER_UNIT"; do
  systemctl cat "$u" >/dev/null 2>&1 || die "$u not installed — run install.sh on the host first"
done
[[ -f "$SRC/apps/api/dist/worker.js" ]] || die "workspace has no worker build"
[[ -d "$SRC/apps/api/dist" && -d "$SRC/apps/web/.next" ]] || die "workspace is not built"
[[ ! -e $TARGET ]] || die "release $RELEASE_ID already exists"

log "database migrations"
MIGRATE_URL=$(env_get "$CONF_DIR/migrate.env" DATABASE_URL)
MIGRATE_PW=$(env_get "$CONF_DIR/migrate.env" NF_MIGRATE_DB_PASSWORD)
(cd "$SRC/packages/db" && DATABASE_URL="$MIGRATE_URL" npx --no-install prisma migrate deploy)
MYSQL_PWD="$MIGRATE_PW" mysql --protocol=tcp -h 127.0.0.1 -u nf_migrate "$DB_NAME" <"$SRC/deploy/oracle-linux/mysql/grants.sql"

log "agent build"
if command -v go >/dev/null; then
  mkdir -p "$SRC/agent-dist"
  for arch in amd64 arm64; do
    (cd "$SRC/agents/nf-agent" && CGO_ENABLED=0 GOOS=linux GOARCH="$arch" \
      go build -trimpath -ldflags "-s -w -X main.version=${RELEASE_ID}" -o "$SRC/agent-dist/nf-agent-linux-$arch" .)
    (cd "$SRC/agents/nf-agent" && CGO_ENABLED=0 GOOS=windows GOARCH="$arch" \
      go build -trimpath -ldflags "-s -w -X main.version=${RELEASE_ID}" -o "$SRC/agent-dist/nf-agent-windows-$arch.exe" .)
  done
else
  log "go is not installed: the release ships without the agent (run install.sh)"
fi

log "staging release $RELEASE_ID"
# Prune in the (disposable) build workspace, where every workspace exists; the next CI run
# starts from a fresh `npm ci`.
(cd "$SRC" && npm prune --omit=dev --no-audit --no-fund >/dev/null)
mkdir -p "$TARGET"
# rsync applies the FIRST matching rule, so exclusions inside included trees come first.
rsync -a --delete   --exclude='/apps/web/.next/cache/***' --exclude='/node_modules/.cache/***' \
  --include='/package.json' --include='/package-lock.json' \
  --include='/node_modules/***' \
  --include='/packages/' --include='/packages/contracts/' --include='/packages/contracts/package.json' --include='/packages/contracts/dist/***' \
  --include='/packages/db/' --include='/packages/db/package.json' --include='/packages/db/dist/***' \
  --include='/apps/' --include='/apps/api/' --include='/apps/api/package.json' --include='/apps/api/dist/***' \
  --include='/apps/web/' --include='/apps/web/package.json' --include='/apps/web/next.config.mjs' \
  --include='/apps/web/.next/***' --include='/apps/web/public/***' \
  --include='/deploy/***' --include='/agent-dist/***' \
  --exclude='*' \
  "$SRC/" "$TARGET/"
printf '%s\n' "$RELEASE_ID" >"$TARGET/RELEASE"
chmod -R go-w "$TARGET"

# The worker has no HTTP port: "healthy" means systemd still has it running after a few seconds.
worker_running() { sleep 5; sudo /usr/bin/systemctl is-active "$WORKER_UNIT" >/dev/null; }

PREVIOUS=$(readlink -f "$CURRENT" 2>/dev/null || true)

activate() {
  ln -sfn "$1" "$CURRENT.next" && mv -T "$CURRENT.next" "$CURRENT"   # atomic switch
  sudo /usr/bin/systemctl restart "$API_UNIT"
  sudo /usr/bin/systemctl restart "$WEB_UNIT"
  sudo /usr/bin/systemctl restart "$WORKER_UNIT"
}

log "activating"
activate "$TARGET"

log "health check"
if wait_for "http://127.0.0.1:${API_PORT}/api/health/ready" "\"release\":\"${RELEASE_ID}\"" 30 \
  && wait_for "http://127.0.0.1:${WEB_PORT}/sign-in" "" 30 \
  && worker_running; then
  log "healthy: $RELEASE_ID"
else
  log "health check FAILED for $RELEASE_ID"
  if [[ -n $PREVIOUS && -d $PREVIOUS && $PREVIOUS != "$TARGET" ]]; then
    log "rolling back to $(basename "$PREVIOUS")"
    activate "$PREVIOUS"
    wait_for "http://127.0.0.1:${API_PORT}/api/health/ready" "" 30 || log "WARNING: previous release is not healthy either"
  fi
  exit 1
fi

log "pruning old releases (keeping $KEEP_RELEASES)"
ACTIVE=$(readlink -f "$CURRENT")
mapfile -t old < <(newest_first "$RELEASES" '*' | tail -n +$((KEEP_RELEASES + 1)))
for d in "${old[@]}"; do
  if [[ -d $d && $d != "$ACTIVE" ]]; then rm -rf -- "$d"; fi
done
log "done"
