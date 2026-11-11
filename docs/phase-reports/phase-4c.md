# Phase 4c report: Windows computers and servers

_Branch `phase-4c-windows-agent` · 2026-11-11_

The agent now runs on Windows too, so an organisation can watch its Windows PCs and servers on
the same pages as its Linux servers. A Windows host reports:

- the same inventory as a Linux server (hardware, disks, network, services, installed programs);
- its network exposure (listening ports and Windows Firewall);
- its pending Windows updates;
- its Windows security settings: antivirus, BitLocker, Remote Desktop, SMB 1.0, UAC, the Guest
  account, Secure Boot and local administrators.

All of it becomes findings with the existing accept-the-risk workflow. Nothing third-party is
involved: the agent is the same Go program (standard library only), and it reads Windows through
components every supported Windows has.

## What was built

### Agent: one program for Linux and Windows

`agents/linux` was renamed to `agents/nf-agent`.

- **Windows service.** The service is registered with the Service Control Manager directly through
  `advapi32` (`StartServiceCtrlDispatcherW`, `RegisterServiceCtrlHandlerExW`,
  `SetServiceStatus`), with no extra libraries.
  - It accepts Stop and Shutdown; a report in flight is cancelled.
  - Started outside the Service Control Manager (error 1063), `run` works in the console.
  - The log goes to `%ProgramData%\NeuralFrontier\agent.log`, keeping one 1 MB rollover.
- **Collection.** Two embedded scripts run with the built-in Windows PowerShell 5.1. Each script
  goes in on standard input, so there's no temporary file and no command-line limit.
  - `collect_windows.ps1` reads CIM (OS, processor, memory, disks, running services), the registry
    (installed programs, RDP, UAC, MachineGuid) and `Get-NetTCPConnection` / `Get-NetUDPEndpoint`
    with the owning processes. It also reads Windows Firewall through `HNetCfg.FwPolicy2`
    (profiles plus enabled inbound allow rules), `Get-MpComputerStatus`, Security Center
    (`root/SecurityCenter2`), `Win32_EncryptableVolume`, `Get-SmbServerConfiguration`,
    `Confirm-SecureBootUEFI`, and the Administrators group by its well-known SID, so it works
    in any display language.
  - `updates_windows.ps1` asks the Windows Update Agent for the result of its last scan
    (`Online = $false`: no download, no network), plus Microsoft's update classification and
    severity, the last successful scan time, and whether a restart is pending. Like dnf and apt,
    it runs at most hourly.
- **Pure conversion layer.** `windows.go` has no build tag and is unit-tested on Linux CI too:
  - the machine ID from MachineGuid, and the OS name, version and build (`10.0.26100.4652`);
  - programs reuse the Linux package list, hashing and "unchanged" optimisation;
  - shared `svchost` processes are named after the services they host;
  - **Windows Firewall is mapped to the common model:**
    - The firewall is active when every connected profile is on.
    - "Default allow" means a connected profile admits unmatched traffic.
    - Allowed ports come from enabled inbound allow rules of the connected profiles.
    - Rules limited to a program or service apply only to that program's current sockets
      (matched by path, or by file name when the path can't be read).
    - Keywords such as `RPC`, `RPC-EPMap` and `IPHTTPS` are understood.
    - Store-app (app container) rules and the "Wi-Fi Direct driver-only" group are left out:
      they don't open ports for other programs, and counting them would flag every PC.
  - **Security Center** product states are decoded (on/off, up to date). **BitLocker** is
    reported as on, off, suspended, encrypting, unavailable (edition without BitLocker) or unknown
    (no rights to ask). **Group Policy** values win over local settings for RDP.
- **OpenSSH Server** on Windows is analysed with the existing `sshd_config` parser (root login
  doesn't apply and isn't reported).

### Installer and endpoints

- `GET /api/agent/v1/install.ps1`: the PowerShell installer.
  - It requires an elevated session and picks the build (x64 or ARM64).
  - It verifies the download against the SHA-256 sums of the files this release serves.
  - It copies (not moves) the program into `C:\Program Files\Neural Frontier`, so it gets the
    folder's permissions and not the download's.
  - It restricts `%ProgramData%\NeuralFrontier` (credential and log) to SYSTEM and
    Administrators, enrols, registers the `nf-agent` service (automatic start, restart on
    failure) and starts it.
  - Re-running it upgrades in place.
- **Self-signed deployments.** The one-line command accepts the server only if its certificate
  matches the pinned SHA-256, even for downloading the installer. This is stricter than `curl -k`
  on Linux. The callback is reset when the installer finishes.
- `GET /api/agent/v1/download/windows-{amd64,arm64}`. The Linux paths are unchanged.
- **New enrollment keys** return `windowsInstallCommand` next to `installCommand`. The same key
  works for both.
- `deploy.sh` builds `nf-agent-windows-{amd64,arm64}.exe` next to the Linux builds.

### Findings (server side, `windows.ts`)

| Key                            | Severity                                      | When                                                                                        |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `windows.antivirus_off`        | high                                          | Neither Defender real-time protection nor another Security Center antivirus is on           |
| `windows.antivirus_unknown`    | medium                                        | Defender didn't answer and Security Center lists nothing: "couldn't confirm", not "off"     |
| `windows.antivirus_stale`      | medium                                        | Defender signatures 7+ days old, or another product reports out of date                     |
| `windows.bitlocker_off`        | medium (low on servers)                       | System drive not encrypted, or BitLocker suspended. Unknown and unavailable are not flagged |
| `windows.rdp_no_nla`           | high                                          | Remote Desktop on without Network Level Authentication                                      |
| `windows.smb1`                 | high                                          | SMB 1.0 server enabled                                                                      |
| `windows.uac_off`              | high                                          | User Account Control off                                                                    |
| `windows.guest_enabled`        | medium                                        | Guest account enabled                                                                       |
| `windows.firewall_profile_off` | medium if the public profile is off, else low | A profile that isn't in use now is off                                                      |
| `windows.secure_boot_off`      | low                                           | Secure Boot off                                                                             |

Existing findings read correctly for Windows:

- `firewall.none` reads "Windows Firewall is off for the connected network".
- `port.exposed:*`, for example RDP or SMB reachable from the network, gives Windows remedies.
- Update findings say "Install them with Windows Update".
- Stale metadata reads "Windows Update last checked N days ago".
- A KB number already in the update title isn't repeated.

### Admin Center

- **Add server** is now "Add a server or computer", with **Linux / Windows** tabs on the command
  screen (a `PS>` prompt for Windows) and the supported versions.
- **Server panel, Security tab:**
  - the Firewall tile reads "Windows Firewall";
  - a "Remote access" tile shows Remote Desktop and NLA;
  - a **Windows protection** section shows antivirus (with signature age), disk encryption,
    Remote Desktop, SMB 1.0, UAC, Guest, Secure Boot, the three firewall profiles (connected one
    marked) and the local administrators.
- **Overview and lists:**
  - "Build" instead of "Kernel", and "Programs" instead of "Packages";
  - server cards show memory instead of load average (Windows has none);
  - update lists show KB titles without an architecture suffix.
- Page descriptions, empty states and command-palette keywords mention Windows.

### Contract changes, all additive

- `windows` (optional) on the inventory, and `exposure.windows` on server details.
- `loadAverage` is nullable.
- New enum values:
  - `packageManager: "windows"`;
  - `updates.manager: "windows-update"`;
  - `firewall.kind: "windows"`.
- `windowsInstallCommand` on issued keys.

Linux agents already deployed keep working unchanged. No migration.

## Evidence

- **Agent on a real Windows 10 Pro 22H2 machine** (the development PC, not elevated):
  - `nf-agent once` produced a report that `tools/validate-inventory.mjs` accepts;
  - 113 services, 57 listening sockets, Defender on with signatures current, RDP on with NLA,
    SMB1 off, UAC on, firewall on in all three profiles (private connected);
  - 15 allowed port ranges, which matched the rules Windows enables on a private network once
    Store-app and Wi-Fi Direct rules were excluded;
  - Windows Update answered from its last scan (0 pending).

  BitLocker and Secure Boot read "unknown" and process owners are empty, as expected without
  elevation. The service runs as LocalSystem.

- **Console mode** (`run` outside the Service Control Manager) on the same machine: it collected,
  reported, backed off and retried as designed.
- **Go unit tests:** these run on Windows locally, and on Linux and Windows in CI.
  - report parsing with a UTF-8 BOM, OS naming and machine ID;
  - disks, programs and services;
  - listeners named after hosted services;
  - firewall mapping:
    - port lists, ranges and the `RPC-EPMap` keyword;
    - program rules (by path, and by file name when the path is unreadable);
    - service rules, and the System process for SMB;
    - Store-app and Wi-Fi Direct rules excluded;
    - a disconnected profile, and missing firewall data;
  - rule port parsing, BitLocker states, the NLA policy overriding the local setting, the UAC
    default;
  - Security Center product states;
  - Windows Update results, including failures and garbage.
- **API unit tests:**
  - 7 new for Windows posture: a clean machine, every weakness, another antivirus in place of
    Defender, "unknown" instead of "off", stale signatures, BitLocker on servers and suspended,
    unreadable settings not flagged;
  - 1 new for update wording.
- **Integration (4 new; the servers suite has 24):**
  - a Windows report becomes posture, exposure and update findings with the right severities,
    and appears on the Updates page;
  - a posture finding can be accepted, and fixing the settings clears findings;
  - malformed Windows reports are refused;
  - `install.ps1` carries the checksums and the locked-down folder permissions, and **parses
    without errors in PowerShell** (where PowerShell is installed);
  - Windows builds are served and unknown ones refused.
- **E2E:**
  - the server test uses the new dialog;
  - a new test issues a key, switches to the Windows tab, enrols with the key from the
    PowerShell command and reports a Windows computer;
  - it then checks the Build label, the Windows protection section, the Remote Desktop and
    BitLocker findings, and the Updates tab with the Windows Update remedy;
  - screenshots 27–29.
- **CI:** a new **Windows agent** job on `windows-latest`:
  - Go vet and tests on Windows;
  - builds for x64 and ARM64;
  - an **elevated** `once` validated against the contract;
  - the agent **registered and started as a real Windows service**, which must collect and log a
    report attempt, keep running, then stop cleanly on request.

  "CI passed" now requires this job. The Linux job also vets the Windows build.

## Not claimed

- **Not tested yet:** the service start/stop on a real Service Control Manager, and an elevated
  (LocalSystem) collection. Both are covered by the new CI job, which hadn't run when this report
  was written. The installer has been parsed but not run end to end against a live server. That
  needs a deployment that serves the Windows build.
- **Firewall analysis evaluates allow rules only.** A block rule, which Windows applies before
  allow rules, may close a port shown as allowed. Group Policy firewall rules are included only
  as far as they appear in the merged policy. Network firewalls are outside the analysis, as on
  Linux. This is stated in the UI.
- **Antivirus from other vendors** is seen only through Security Center, which exists on client
  editions. On Windows Server, a non-Microsoft antivirus shows as "couldn't confirm".
- **Windows Update results are as fresh as Windows' own last scan.** The agent doesn't start a
  scan; a scan 7+ days old is a finding. Driver updates aren't listed.
- **Not covered:** Windows 7/8.1 and Server 2012 R2 or older are out of support and not
  targeted. ARM64 builds are compiled but haven't run on ARM64 hardware.
- **The service runs as LocalSystem**, which BitLocker, Secure Boot and process owners require.
  It is read-only by design and accepts no commands, but it isn't sandboxed the way the systemd
  unit is. See threat T9.
- Agents don't update themselves. Re-running the command upgrades them, as on Linux.
