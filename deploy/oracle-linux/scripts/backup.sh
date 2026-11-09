#!/usr/bin/env bash
# Neural Frontier — encrypted logical backup of the neural_frontier database. Runs as root
# (systemd timer). AES-256 via OpenSSL with a PBKDF2-derived key from /etc/neural-frontier/backup.key,
# SHA-256 sidecar, 14-day retention. Runs the restore test every Sunday.
set -euo pipefail
SCRIPT_NAME=backup
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
need_root

RETENTION_DAYS=${RETENTION_DAYS:-14}
KEY="$CONF_DIR/backup.key"
[[ -r $KEY ]] || die "backup key $KEY missing"
umask 077
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz.enc"

log "dumping $DB_NAME"
mysqldump --protocol=socket --single-transaction --quick --routines --triggers --events \
  --set-gtid-purged=OFF --no-tablespaces --databases "$DB_NAME" \
  | gzip -6 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY" -out "$OUT.partial"
mv "$OUT.partial" "$OUT"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$OUT")" >"$(basename "$OUT").sha256")
log "wrote $OUT ($(du -h "$OUT" | cut -f1))"

find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.sql.gz.enc*" -mtime +"$RETENTION_DAYS" -delete
printf '{"lastBackup":"%s","file":"%s"}\n' "$(date -u +%FT%TZ)" "$(basename "$OUT")" >"$STATE_DIR/last-backup.json"

if [[ $(date +%u) -eq 7 ]]; then
  "$HERE/restore-test.sh" "$OUT"
fi
