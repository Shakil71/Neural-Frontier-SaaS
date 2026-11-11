import type { AgentWindows } from "@nf/contracts";
import { describe, expect, it } from "vitest";
import { windowsFindings } from "./windows.js";

const NOW = "2026-11-11T12:00:00Z";

/** A well-configured Windows 11 workstation. */
const good: AgentWindows = {
  server: false,
  antivirus: [{ name: "Windows Defender", enabled: true, upToDate: true }],
  defender: {
    antivirusEnabled: true,
    realTimeProtection: true,
    tamperProtection: true,
    signaturesUpdatedAt: "2026-11-11T08:00:00Z",
  },
  bitlocker: "on",
  systemDrive: "C:",
  rdp: { enabled: false, nla: true, port: 3389 },
  smb1: false,
  uac: true,
  guestEnabled: false,
  secureBoot: true,
  admins: ["PC-1\\Administrator"],
  firewallProfiles: [
    { name: "domain", active: false, enabled: true, defaultInboundAllow: false },
    { name: "private", active: true, enabled: true, defaultInboundAllow: false },
    { name: "public", active: false, enabled: true, defaultInboundAllow: false },
  ],
};

const keys = (w: AgentWindows) => windowsFindings(w, NOW).map((f) => `${f.key}:${f.severity}`);

describe("windows posture", () => {
  it("a well-configured computer has no findings", () => {
    expect(windowsFindings(good, NOW)).toEqual([]);
  });

  it("reports every weakness with its severity", () => {
    const bad: AgentWindows = {
      ...good,
      defender: { ...good.defender!, realTimeProtection: false },
      antivirus: [{ name: "Windows Defender", enabled: false, upToDate: true }],
      bitlocker: "off",
      rdp: { enabled: true, nla: false, port: 3390 },
      smb1: true,
      uac: false,
      guestEnabled: true,
      secureBoot: false,
      firewallProfiles: [
        { name: "domain", active: false, enabled: false, defaultInboundAllow: false },
        { name: "private", active: true, enabled: true, defaultInboundAllow: false },
        { name: "public", active: false, enabled: false, defaultInboundAllow: false },
      ],
    };
    expect(keys(bad)).toEqual([
      "windows.antivirus_off:high",
      "windows.bitlocker_off:medium",
      "windows.rdp_no_nla:high",
      "windows.smb1:high",
      "windows.uac_off:high",
      "windows.guest_enabled:medium",
      "windows.firewall_profile_off:medium",
      "windows.secure_boot_off:low",
    ]);
    const f = windowsFindings(bad, NOW);
    expect(f.find((x) => x.key === "windows.rdp_no_nla")!.detail).toContain("port 3390");
    expect(f.find((x) => x.key === "windows.firewall_profile_off")!.title).toBe(
      "Windows Firewall is off for domain and public networks",
    );
  });

  it("accepts another active antivirus in place of Defender", () => {
    const w: AgentWindows = {
      ...good,
      defender: { ...good.defender!, antivirusEnabled: false, realTimeProtection: false },
      antivirus: [
        { name: "Windows Defender", enabled: false, upToDate: true },
        { name: "Example Endpoint Security", enabled: true, upToDate: false },
      ],
    };
    expect(keys(w)).toEqual(["windows.antivirus_stale:medium"]);
  });

  it("says when no antivirus can be confirmed instead of claiming one is off", () => {
    expect(keys({ ...good, server: true, defender: null, antivirus: [] })).toEqual([
      "windows.antivirus_unknown:medium",
    ]);
  });

  it("flags old Defender signatures", () => {
    const w = {
      ...good,
      defender: { ...good.defender!, signaturesUpdatedAt: "2026-11-01T12:00:00Z" },
    };
    const [f] = windowsFindings(w, NOW);
    expect(f).toMatchObject({
      key: "windows.antivirus_stale",
      title: "Antivirus signatures are 10 days old",
    });
  });

  it("rates BitLocker lower on servers and explains suspension", () => {
    expect(keys({ ...good, server: true, bitlocker: "off" })).toEqual([
      "windows.bitlocker_off:low",
    ]);
    const [f] = windowsFindings({ ...good, bitlocker: "suspended" }, NOW);
    expect(f!.title).toBe("BitLocker is suspended on the system drive (C:)");
    // Unknown (no rights to ask) and unavailable (Home edition) aren't claimed as weaknesses.
    expect(keys({ ...good, bitlocker: "unknown" })).toEqual([]);
    expect(keys({ ...good, bitlocker: "unavailable" })).toEqual([]);
  });

  it("does not flag Remote Desktop with NLA, or settings it couldn't read", () => {
    expect(keys({ ...good, rdp: { enabled: true, nla: true, port: 3389 } })).toEqual([]);
    expect(keys({ ...good, smb1: null, uac: null, guestEnabled: null, secureBoot: null })).toEqual(
      [],
    );
  });
});
