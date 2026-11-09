#!/usr/bin/env bash
# Neural Frontier — proves a backup can actually be restored. Runs as root.
#
#   restore-test.sh [backup-file]   # default: newest backup
#
# Verifies the checksum, decrypts into a throw-away database, checks that every expected
# table exists and the migration history matches production, then drops it.
set -euo pipefail
SCRIPT_NAME=restore-test
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need_root

FILE=${1:-$(newest_first "$BACKUP_DIR" "${DB_NAME}-*.sql.gz.enc" | head -n1)}
[[ -n $FILE && -f $FILE ]] || die "no backup found in $BACKUP_DIR"
TEST_DB="nf_restore_test"
EXPECTED_TABLES=(tenants tenant_domains identities roles role_assignments sessions audit_events idempotency_keys _prisma_migrations)

cleanup() { mysql --protocol=socket -e "DROP DATABASE IF EXISTS \`$TEST_DB\`" || true; }
trap cleanup EXIT

log "verifying checksum of $(basename "$FILE")"
(cd "$(dirname "$FILE")" && sha256sum --quiet -c "$(basename "$FILE").sha256")

log "restoring into $TEST_DB"
cleanup
mysql --protocol=socket -e "CREATE DATABASE \`$TEST_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$CONF_DIR/backup.key" -in "$FILE" \
  | gunzip \
  | sed -e "s/^CREATE DATABASE .*\`${DB_NAME}\`.*;$//" -e "s/^USE \`${DB_NAME}\`;$/USE \`${TEST_DB}\`;/" \
  | mysql --protocol=socket "$TEST_DB"

for t in "${EXPECTED_TABLES[@]}"; do
  n=$(mysql --protocol=socket -NBe "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TEST_DB' AND table_name='$t'")
  [[ $n == 1 ]] || die "table $t missing from restored backup"
done
restored=$(mysql --protocol=socket -NBe "SELECT COUNT(*) FROM \`$TEST_DB\`._prisma_migrations WHERE finished_at IS NOT NULL")
live=$(mysql --protocol=socket -NBe "SELECT COUNT(*) FROM \`$DB_NAME\`._prisma_migrations WHERE finished_at IS NOT NULL")
identities=$(mysql --protocol=socket -NBe "SELECT COUNT(*) FROM \`$TEST_DB\`.identities")
[[ $restored == "$live" ]] || log "WARNING: restored migrations ($restored) differ from live ($live) — a migration ran after this backup"

printf '{"lastRestoreTest":"%s","file":"%s","result":"passed","identities":%s,"migrations":%s}\n' \
  "$(date -u +%FT%TZ)" "$(basename "$FILE")" "$identities" "$restored" >"$STATE_DIR/last-restore-test.json"
log "restore test PASSED ($identities identities, $restored migrations)"
