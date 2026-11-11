import type { AgentWindows, ServerFinding } from "@nf/contracts";

/**
 * Windows security posture (Phase 4c). Pure functions over what the Windows agent reported:
 * antivirus, disk encryption, Remote Desktop, legacy SMB, UAC, the Guest account, Secure Boot
 * and firewall profiles. No I/O, unit-tested.
 */

type Draft = Omit<ServerFinding, "accepted">;

const DAY_MS = 86_400_000;
/** Antivirus signatures older than this miss recent threats. */
export const STALE_SIGNATURE_DAYS = 7;

const PROFILE_LABEL = { domain: "domain", private: "private", public: "public" } as const;

export function windowsFindings(w: AgentWindows, collectedAt: string): Draft[] {
  const out: Draft[] = [];
  const machine = w.server ? "server" : "computer";

  // Antivirus: Defender in real time, or any product Security Center reports as on.
  const defenderOn = !!w.defender && w.defender.antivirusEnabled && w.defender.realTimeProtection;
  const othersOn = w.antivirus.filter((a) => a.enabled && !/defender/i.test(a.name));
  if (!defenderOn && othersOn.length === 0) {
    if (!w.defender && w.antivirus.length === 0) {
      out.push({
        key: "windows.antivirus_unknown",
        severity: "medium",
        title: "No antivirus could be confirmed",
        detail:
          "Microsoft Defender Antivirus didn't answer and Windows Security Center lists no other antivirus (it lists them on client editions only).",
        remedy:
          "Make sure an antivirus runs on this " +
          machine +
          ". On Windows Server, install the Microsoft Defender Antivirus feature or confirm the product in use.",
      });
    } else {
      out.push({
        key: "windows.antivirus_off",
        severity: "high",
        title: "Antivirus real-time protection is off",
        detail: w.defender
          ? `Microsoft Defender Antivirus is ${w.defender.antivirusEnabled ? "on, but real-time protection is off" : "off"}, and no other antivirus is active.`
          : "No antivirus registered with Windows Security Center is active.",
        remedy:
          "Turn on real-time protection in Windows Security → Virus & threat protection, or check the antivirus product in use.",
      });
    }
  }

  // Signature age (Defender, when it's the active antivirus).
  if (defenderOn && w.defender?.signaturesUpdatedAt) {
    const age = Math.floor(
      (Date.parse(collectedAt) - Date.parse(w.defender.signaturesUpdatedAt)) / DAY_MS,
    );
    if (age >= STALE_SIGNATURE_DAYS) {
      out.push({
        key: "windows.antivirus_stale",
        severity: "medium",
        title: `Antivirus signatures are ${age} days old`,
        detail: "Threats discovered since then aren't recognised.",
        remedy:
          "Check that Windows Update (or your update server) delivers Defender security intelligence updates.",
      });
    }
  } else if (othersOn.some((a) => !a.upToDate)) {
    out.push({
      key: "windows.antivirus_stale",
      severity: "medium",
      title: "Antivirus signatures are out of date",
      detail: `Windows Security Center reports ${othersOn
        .filter((a) => !a.upToDate)
        .map((a) => a.name)
        .join(", ")} as out of date.`,
      remedy: "Update the antivirus product and check that it can reach its update service.",
    });
  }

  // Disk encryption.
  if (w.bitlocker === "off" || w.bitlocker === "suspended") {
    out.push({
      key: "windows.bitlocker_off",
      severity: w.server ? "low" : "medium",
      title:
        w.bitlocker === "off"
          ? `The system drive (${w.systemDrive}) isn't encrypted`
          : `BitLocker is suspended on the system drive (${w.systemDrive})`,
      detail:
        w.bitlocker === "off"
          ? "Anyone with the disk can read its data, including cached credentials."
          : "The drive is encrypted but its key is stored in the clear until protection resumes.",
      remedy:
        w.bitlocker === "off"
          ? "Turn on BitLocker for the system drive and keep the recovery key somewhere safe."
          : "Resume BitLocker protection (Resume-BitLocker, or Control Panel → BitLocker Drive Encryption).",
    });
  }

  // Remote Desktop without Network Level Authentication.
  if (w.rdp.enabled && w.rdp.nla === false) {
    out.push({
      key: "windows.rdp_no_nla",
      severity: "high",
      title: "Remote Desktop accepts connections before sign-in",
      detail: `Remote Desktop is on (port ${w.rdp.port}) without Network Level Authentication, so anyone who can reach it gets a sign-in screen and the full RDP attack surface.`,
      remedy:
        "Require Network Level Authentication (System → Remote Desktop → Advanced settings), or turn Remote Desktop off.",
    });
  }

  if (w.smb1 === true) {
    out.push({
      key: "windows.smb1",
      severity: "high",
      title: "SMB 1.0 file sharing is on",
      detail:
        "SMBv1 is the obsolete protocol behind WannaCry and NotPetya. Current Windows versions don't need it.",
      remedy:
        "Turn it off with Set-SmbServerConfiguration -EnableSMB1Protocol $false (or remove the SMB 1.0/CIFS feature).",
    });
  }

  if (w.uac === false) {
    out.push({
      key: "windows.uac_off",
      severity: "high",
      title: "User Account Control is off",
      detail:
        "Every program an administrator starts runs with full rights, without asking, so malware gets them too.",
      remedy: "Turn User Account Control on (EnableLUA = 1) and restart.",
    });
  }

  if (w.guestEnabled === true) {
    out.push({
      key: "windows.guest_enabled",
      severity: "medium",
      title: "The Guest account is enabled",
      detail:
        "It allows signing in without a personal account, so actions can't be traced to anyone.",
      remedy: "Disable it (Disable-LocalUser -Name Guest).",
    });
  }

  // Firewall profiles that are off but not in use now: they apply as soon as the host joins a
  // network of that type. (An active profile that is off is reported as "No firewall".)
  const offline = w.firewallProfiles.filter((p) => !p.enabled && !p.active);
  if (offline.length > 0) {
    const names = offline.map((p) => PROFILE_LABEL[p.name]).join(" and ");
    out.push({
      key: "windows.firewall_profile_off",
      severity: offline.some((p) => p.name === "public") ? "medium" : "low",
      title: `Windows Firewall is off for ${names} networks`,
      detail: `The ${machine} isn't on such a network now, but would be unprotected as soon as it joins one.`,
      remedy:
        "Turn the firewall on for every profile (Windows Security → Firewall & network protection).",
    });
  }

  if (w.secureBoot === false) {
    out.push({
      key: "windows.secure_boot_off",
      severity: "low",
      title: "Secure Boot is off",
      detail: "Boot-level malware (bootkits) can load before Windows and its antivirus.",
      remedy: "Turn Secure Boot on in the UEFI firmware settings.",
    });
  }

  return out;
}
