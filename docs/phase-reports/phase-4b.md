# Phase 4b report: patch compliance

_Branch `phase-4b-patch-compliance` · 2026-11-10_

The second Infrastructure slice. Each server now reports which updates are waiting, which of them
fix security issues and how severe those are, and whether a reboot is needed to run an installed
kernel. The Admin Center shows this per server and across all servers.

## What was built

| Area                              | Delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent (Go, standard library only) | **RHEL family:** `dnf -C check-update` (pending updates) and `dnf -C updateinfo list --updates` (security advisories, ELSA/RHSA, with severity), from the local metadata cache only: no network, no installs. **Debian family:** `apt list --upgradable`, with `-security` suites marking security updates. **Reboot:** newest installed kernel vs `uname -r` with an rpm version comparison, or `/run/reboot-required`. Checked at most hourly; reports in between reuse the result.        |
| Agent unit                        | One new permission: `ReadWritePaths=-/var/cache/dnf`, because dnf takes a lock in its cache even in cache-only mode. Everything else stays read-only, and the agent still has no capabilities. The log goes to the private `/tmp`.                                                                                                                                                                                                                                                           |
| Findings                          | `updates.security`: high if any advisory is Critical or Important, medium for Moderate (and for Debian, which doesn't rate them), low otherwise. `updates.reboot_required`: medium. `updates.stale_metadata`: low, when package information is 7+ days old, because "up to date" can't be trusted then. They can be accepted like exposure findings.                                                                                                                                         |
| Admin Center                      | **Infrastructure → Updates:** up to date, need security updates, need a reboot, security updates waiting; every server with its state (most urgent first) and a "most needed security updates" list across servers. **Server panel → Updates tab:** counts, findings, and the pending packages with severity and advisory, searchable. Server cards show an update badge. **Exposure is now "Security findings"** (`/findings`; `/exposure` redirects), since it also lists update findings. |
| API                               | `GET /api/v1/server-updates`. Server summaries carry `updates`; details carry `patches` and `patchFindings`. Older agents keep working and show "No update data", never "up to date". A package manager that can't answer is shown as "Can't check".                                                                                                                                                                                                                                         |

No migration: the patch state is part of the stored inventory, and acceptances reuse the 4a table.

## Evidence

- **Agent unit tests (Go):**
  - rpm version comparison, including `~`, `^`, leading zeros and real kernel releases, with
    antisymmetry checked;
  - choosing the newest kernel of the running flavour (UEK vs distribution kernel);
  - name/arch splitting with epochs;
  - `dnf check-update` (wrapped lines, security notices, obsoletes);
  - `updateinfo`: the most severe advisory wins, and bugfix advisories aren't security;
  - `apt list --upgradable`.
- **API unit tests (6):** severity rules, Debian handling, reboot messages, stale metadata, and
  silence when the package manager couldn't answer.
- **Integration (5 new; the servers suite has 20):**
  - findings and counts from a report with updates;
  - organisation view and top packages;
  - accepting an update finding;
  - "unavailable" never counts as up to date;
  - malformed and oversized reports refused;
  - tenant isolation;
  - the installer's unit has the dnf cache permission.

  The whole suite: 147 passed, 1 skipped.

- **E2E:** the server test now also reports updates. It checks the Updates tab, opens the Updates
  page, and opens the server from there. The findings page is reached at its new address.
  Screenshots 20 and 21. All 11 tests pass.
- **On the production host (Oracle Linux 9, 2026-11-10):** under the agent's sandbox,
  `dnf -C updateinfo` worked once `/var/cache/dnf` was writable and the log was moved. It found
  ELSA-2026-500574 (Important) for a newer UEK kernel that is installed but not running, so that
  server needs a reboot for the fix to take effect.

## Not claimed

- **Verified after deploy (2026-11-11, release 20261111135409-e7894c9f808c):** the released
  binary ran on the production host under the service's sandbox. dnf answered from its cache
  (0 pending), and it flagged a reboot: kernel 5.15.0-326.222.4 was running while
  326.224.5.0.1 was installed. The VPS agent was updated to this release, its unit got
  `ReadWritePaths=-/var/cache/dnf`, and it reports.
- The Debian/Ubuntu path is unit-tested, and CI runs it on the Ubuntu runner without the systemd
  sandbox. It hasn't run on a Debian host under the sandbox.
- Results are only as fresh as the package metadata, which the system's own timers refresh
  (`dnf-makecache.timer`, apt's daily update). The agent doesn't refresh it, and says when it's
  stale.
- Agents don't update themselves. Each server needs the install command run again, which also
  installs the updated unit.
