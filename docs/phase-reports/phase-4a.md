# Phase 4a report: network exposure

_Branch `phase-4a-exposure` · 2026-11-10_

The first slice of the Infrastructure phase. The Linux agent now reports what each server exposes
to the network, and the Admin Center shows what to fix: sensitive services reachable from
outside, a missing or permissive firewall, and SSH settings that let passwords be guessed.

## What was built

| Area                              | Delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent (Go, standard library only) | **Listening sockets** from `/proc/net/{tcp,tcp6,udp,udp6}` (TCP LISTEN and unconnected UDP), with the owning user; the process where `/proc/<pid>/fd` is readable. **Firewall:** firewalld (active and default zones, services resolved to ports, zone targets, source-bound zones marked "limited"), ufw (rule files and default policy), or "nftables/iptables running, rules not readable". **SSH:** the effective `sshd_config` (first value wins, `Include` expanded, `Match` blocks skipped, OpenSSH defaults). Still read-only, still no capabilities. |
| Analysis (API, pure functions)    | Each socket gets a scope (loopback, private, public, all interfaces) and a firewall verdict (local, open, allowed, limited, blocked, unknown). Findings: no firewall; default-allow firewall; 26 sensitive services (databases, caches, Docker/Kubernetes APIs, SMB, RDP, VNC, Telnet, FTP and others) reachable; SSH with empty passwords, root password login, root key login, password or keyboard-interactive login. Severity drops when the host has only private addresses or the firewall limits the sources.                                          |
| Accept the risk                   | An administrator can accept a finding with a reason. It stays visible, marked as accepted, stops counting as open, survives new reports and can be reopened. Only a finding the server has now can be accepted.                                                                                                                                                                                                                                                                                                                                               |
| Admin Center                      | **Infrastructure → Exposure:** open findings by severity, servers analysed, filters (all open, high, medium, low, accepted); a host link opens that server's Security tab. **Servers:** a findings badge on each card, a banner when there are high-severity findings, and a **Security** tab with firewall, SSH and listening tiles, the findings, and a port table with the firewall verdict per port.                                                                                                                                                      |
| API                               | `GET /api/v1/server-findings`; `PUT` and `DELETE /api/v1/servers/{id}/findings/{key}/acceptance`. Server summaries carry open finding counts; server detail carries the full exposure. Older agents keep working (the new fields are optional) and show "no exposure data", never a false all-clear.                                                                                                                                                                                                                                                          |
| Permissions and audit             | Reading uses `servers.read`; accepting and reopening use `servers.manage`. Audit actions `server.finding_accepted` (with finding, severity and reason) and `server.finding_reopened`.                                                                                                                                                                                                                                                                                                                                                                         |

**Data:** migration `20261117000000_exposure_findings` adds `server_finding_acceptances` (composite
foreign key to the server, so it can't point into another tenant), with a tenant-guard entry and
a grant. Findings themselves aren't stored; they're computed from the latest report.

## Evidence

- **Agent unit tests (Go):** `/proc/net` address decoding (IPv4, IPv6 word order, IPv4-mapped),
  socket filtering, de-duplication and ordering, `/etc/passwd`, firewalld zone and service
  parsing (including a source-bound ACCEPT zone), ufw rule tuples (ranges, lists, `any`, `limit`,
  direction, deny), and `sshd_config` (Include order, first value wins, `Match`, deprecated
  aliases, defaults, missing file). `gofmt` and `go vet` (GOOS=linux) are clean.
- **API unit tests (25):** address scopes, firewall verdicts, and findings for a hardened host,
  an open public host, a private-only host, limited and unknown firewall rules, SSH only when
  sshd listens, a default-allow firewall, one finding per port, and open counts.
- **Integration (6 new, 15 in the servers suite):** an old-style report gives no findings (null,
  not zero); a full report gives the expected listeners and findings; the organisation view
  counts them; auditors can't accept; reasons are validated; unknown and malformed keys are
  refused; acceptance survives new reports, is audited and can be reopened; fixing the server
  clears the findings; other tenants see nothing and can't accept. The whole suite: 142 passed,
  1 skipped.
- **E2E:** the existing server test now reports exposure. It checks the Security tab, follows the
  high-severity banner to the Exposure page, accepts the Redis finding with a reason, sees it
  under Accepted, and finds it in the audit log. Screenshots 18 and 19. All 11 E2E tests pass.
- CI runs the real agent (`nf-agent once`) on its Ubuntu runner and validates the output, now
  including listeners, firewall and SSH, against the API contract.

## Not claimed

- The new collectors haven't run on a real server under the hardened systemd unit. In
  particular, whether `firewall-cmd` answers a root process without capabilities over D-Bus is
  expected but unverified. If it doesn't, the firewall shows as "rules not readable" (not as
  "none"). The production VPS has no agent installed yet.
- The analysis sees the host firewall only. Cloud security groups, upstream firewalls and
  Docker-published ports are outside it, and the UI says so.
- firewalld rich rules and ufw deny-before-allow ordering aren't evaluated.
- Agents don't update themselves. Each server needs the install command run again.
