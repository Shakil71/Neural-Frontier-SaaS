#!/usr/bin/env bash
# Neural Frontier — read-only host validation. Run as root after install and after deploys.
# Prints PASS/WARN/FAIL per check; exits 1 if any check fails. Changes nothing.
set -uo pipefail
SCRIPT_NAME=validate
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"

fails=0
pass() { printf '  \e[32mPASS\e[0m %s\n' "$*"; }
warn() { printf '  \e[33mWARN\e[0m %s\n' "$*"; }
fail() { printf '  \e[31mFAIL\e[0m %s\n' "$*"; fails=$((fails + 1)); }
check() { local desc=$1; shift; if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi; }

echo "Platform"
check "Oracle Linux / RHEL 9" grep -q 'VERSION_ID="9' /etc/os-release
check "Node.js >= 22.12 ($(node -v 2>/dev/null))" node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
check "SELinux enforcing" test "$(getenforce)" = Enforcing
for p in "$HTTP_PORT" "$HTTPS_PORT"; do
  check "SELinux http_port_t includes $p" bash -c "semanage port -l | grep -qE '^http_port_t .*\\b$p\\b'"
  check "firewalld allows $p/tcp" firewall-cmd --query-port="$p/tcp"
done

echo "Configuration"
for f in api.env web.env migrate.env secrets.env backup.key; do
  check "$CONF_DIR/$f present" test -f "$CONF_DIR/$f"
done
expect_mode() {
  local file=$1 want=$2 mode
  mode=$(stat -c %a "$CONF_DIR/$file" 2>/dev/null)
  if [[ $mode == "$want" ]]; then pass "$file mode $want"; else fail "$file mode is ${mode:-missing}, expected $want"; fi
}
for f in api.env web.env migrate.env; do expect_mode "$f" 640; done
for f in secrets.env backup.key; do expect_mode "$f" 600; done
check "api.env has NF_DATA_KEY (connector credential encryption)" grep -q "^NF_DATA_KEY=." "$CONF_DIR/api.env"
check "nginx configuration valid" nginx -t

echo "Services"
for u in "$API_UNIT" "$WEB_UNIT" "$WORKER_UNIT" neural-frontier-backup.timer; do
  check "$u active" systemctl is-active "$u"
done
check "API listens on 127.0.0.1:$API_PORT only" bash -c "ss -tln | grep -q '127.0.0.1:$API_PORT '"
check "Web listens on 127.0.0.1:$WEB_PORT only" bash -c "ss -tln | grep -q '127.0.0.1:$WEB_PORT '"
check "API readiness" curl -fsS --max-time 5 "http://127.0.0.1:$API_PORT/api/health/ready"
check "HTTPS front door serves sign-in" curl -fsSk --max-time 5 "https://127.0.0.1:$HTTPS_PORT/sign-in"
code=$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:$HTTPS_PORT/api/metrics")
if [[ $code == 404 ]]; then pass "metrics not exposed publicly"; else fail "metrics endpoint returned $code via nginx"; fi
release=$(cat "$CURRENT/RELEASE" 2>/dev/null || echo none)
pass "current release: $release"

echo "Data protection"
latest=$(newest_first "$BACKUP_DIR" "${DB_NAME}-*.sql.gz.enc" | head -n1)
if [[ -z $latest ]]; then
  warn "no backups yet (timer runs daily at 02:30)"
elif [[ $(find "$latest" -mmin -$((36 * 60)) | wc -l) -eq 1 ]]; then
  pass "latest backup < 36h old ($(basename "$latest"))"
else
  fail "latest backup is older than 36h"
fi
if [[ -f "$STATE_DIR/last-restore-test.json" ]]; then
  pass "last restore test: $(cat "$STATE_DIR/last-restore-test.json")"
else
  warn "no restore test recorded yet (run: $ROOT_LIB/restore-test.sh)"
fi
for d in "$APP_ROOT" "$BACKUP_DIR"; do
  use=$(df --output=pcent "$d" | tail -n1 | tr -dc 0-9)
  if ((use < 85)); then pass "$d disk ${use}% used"; else warn "$d disk ${use}% used"; fi
done

echo
if ((fails)); then echo "$fails check(s) failed"; exit 1; fi
echo "All checks passed"
