# Phase 2d report: Linux inventory agent and the Servers page

_Merged to `main` (b20ead7) · deployed 2026-11-10 (release `20261110104538-083129c2354a`)_

## What was built

| Area                                              | Delivered                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent (`agents/linux`, Go, standard library only) | Static binaries for amd64 and arm64. Reports OS, CPU, memory, disks, network interfaces, running services and installed packages (rpm/dpkg) every 5 minutes. Read-only: it accepts no commands. Packages are sent only when their hash changes. Retries with backoff. Pins the server certificate (`sha256:`) while it is self-signed. Config at `/etc/nf-agent/agent.json`, mode 0600. |
| Enrolment                                         | Enrollment keys (`nfe_`) with expiry, use limits and revocation. Each server gets its own token (`nfa_`), stored only as a hash. Retiring a server cuts its agent off immediately.                                                                                                                                                                                                      |
| Installer                                         | `GET /api/agent/v1/install.sh` gives a one-line command. It checks the binary's SHA-256 and installs a hardened systemd unit.                                                                                                                                                                                                                                                           |
| Admin Center                                      | **Infrastructure → Servers:** online / not reporting / offline status, memory and disk bars, load and uptime. A detail panel has tabs for disks, network, services and packages, with search. An "Add server" dialog issues a key and the install command.                                                                                                                              |
| CI                                                | A Go job runs gofmt, vet, race-enabled tests and both builds. It then runs `nf-agent once` on the runner and validates the real output against the API contract (`tools/validate-inventory.mjs`).                                                                                                                                                                                       |
| Deploy                                            | `install.sh` installs Go from Oracle Linux AppStream and sets `NF_TLS_CERT_FILE`. `deploy.sh` builds the agent into the release. The first production deploy found that the built agent wasn't copied into the release; fixed in 083129c.                                                                                                                                               |

## Evidence

- Go unit tests cover the parsers: os-release, meminfo, cpuinfo, mounts (deduplication and
  octal escapes), packages (sorted, stable hash), systemctl, UTF-8-safe clipping and machine-id.
- API integration tests cover:
  - key management (administrators manage, auditors only view);
  - refusal of unknown, revoked and used-up keys;
  - enrol → report → online;
  - unchanged packages skipped, and 409 `packages_required` when they are needed;
  - malformed reports and a token copied to another machine are refused;
  - re-enrolling rotates the token;
  - retiring a server is audited and cuts the agent off;
  - tenant isolation;
  - the checksum-verifying installer, which serves only known builds.
- An E2E test adds a server, simulates the agent, and checks that the report appears in the Admin
  Center.
- In production, `install.sh` is served (200) and the amd64 binary downloads (6.4 MB). The
  binary reports the release id as its version.

## Not claimed

- The agent isn't installed on the production VPS yet. Installing it needs an enrollment key
  created by a signed-in administrator.
- Only the parsers are unit-tested across distributions. Ubuntu, Debian, Rocky and Alma haven't
  been run in CI; only the GitHub Ubuntu runner and Oracle Linux 9 (the build host) have.
