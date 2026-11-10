import type { AgentFirewall, AgentListener, AgentSsh } from "@nf/contracts";
import { describe, expect, it } from "vitest";
import {
  addressScope,
  analyseListeners,
  countOpen,
  findings,
  firewallReach,
  hasPublicAddress,
} from "./exposure.js";

const listener = (proto: "tcp" | "udp", address: string, port: number): AgentListener => ({
  proto,
  address,
  port,
  user: "root",
  process: "",
});

const firewalld = (allowed: AgentFirewall["allowed"], extra: Partial<AgentFirewall> = {}) =>
  ({
    kind: "firewalld",
    active: true,
    rulesKnown: true,
    defaultAllow: false,
    zones: ["public"],
    allowed,
    ...extra,
  }) satisfies AgentFirewall;

const noFirewall: AgentFirewall = {
  kind: "none",
  active: false,
  rulesKnown: false,
  defaultAllow: false,
  zones: [],
  allowed: [],
};

const hardenedSsh: AgentSsh = {
  present: true,
  ports: [22],
  permitRootLogin: "no",
  passwordAuthentication: "no",
  kbdInteractiveAuthentication: "no",
  usePam: "yes",
  permitEmptyPasswords: "no",
};

describe("addressScope", () => {
  it.each([
    ["0.0.0.0", "all"],
    ["::", "all"],
    ["127.0.0.1", "loopback"],
    ["127.0.0.53", "loopback"],
    ["::1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.32.0.1", "public"],
    ["192.168.197.100", "private"],
    ["100.64.0.1", "private"],
    ["169.254.1.1", "private"],
    ["fe80::1", "private"],
    ["fd12:3456::1", "private"],
    ["203.0.113.7", "public"],
    ["2001:db8::1", "public"],
    ["192.168.1.10/24", "private"],
  ])("%s is %s", (addr, scope) => {
    expect(addressScope(addr)).toBe(scope);
  });

  it("knows whether a host has a public address", () => {
    expect(hasPublicAddress(["192.168.1.10/24", "fe80::1/64"])).toBe(false);
    expect(hasPublicAddress(["10.0.0.4/24", "203.0.113.7/32"])).toBe(true);
  });
});

describe("firewallReach", () => {
  const fw = firewalld([
    { proto: "tcp", from: 22, to: 22, scope: "any" },
    { proto: "tcp", from: 3306, to: 3306, scope: "limited" },
    { proto: "udp", from: 6000, to: 6010, scope: "any" },
  ]);

  it("matches protocol and range", () => {
    expect(firewallReach(fw, "tcp", 22)).toBe("allowed");
    expect(firewallReach(fw, "udp", 22)).toBe("blocked");
    expect(firewallReach(fw, "udp", 6005)).toBe("allowed");
    expect(firewallReach(fw, "tcp", 3306)).toBe("limited");
    expect(firewallReach(fw, "tcp", 6379)).toBe("blocked");
  });

  it("treats no firewall as open and unreadable rules as unknown", () => {
    expect(firewallReach(noFirewall, "tcp", 22)).toBe("open");
    expect(firewallReach({ ...fw, kind: "nftables", rulesKnown: false }, "tcp", 22)).toBe(
      "unknown",
    );
    expect(firewallReach({ ...fw, defaultAllow: true }, "tcp", 6379)).toBe("open");
  });
});

describe("findings", () => {
  it("reports nothing for a hardened host", () => {
    const fw = firewalld([{ proto: "tcp", from: 22, to: 22, scope: "any" }]);
    const ls = analyseListeners(
      [listener("tcp", "0.0.0.0", 22), listener("tcp", "0.0.0.0", 3306)],
      fw,
    );
    expect(ls.map((l) => [l.port, l.reach, l.service])).toEqual([
      [22, "allowed", "SSH"],
      [3306, "blocked", "MySQL"],
    ]);
    expect(findings({ listeners: ls, firewall: fw, ssh: hardenedSsh, publicHost: true })).toEqual(
      [],
    );
  });

  it("flags an unprotected public host", () => {
    const ls = analyseListeners(
      [
        listener("tcp", "0.0.0.0", 22),
        listener("tcp", "::", 6379),
        listener("tcp", "127.0.0.1", 3306), // loopback: never a finding
        listener("tcp", "0.0.0.0", 8080), // not a sensitive port
      ],
      noFirewall,
    );
    const ssh: AgentSsh = {
      ...hardenedSsh,
      permitRootLogin: "yes",
      passwordAuthentication: "yes",
      permitEmptyPasswords: "yes",
    };
    const got = findings({ listeners: ls, firewall: noFirewall, ssh, publicHost: true });
    expect(got.map((f) => [f.key, f.severity])).toEqual([
      ["firewall.none", "high"],
      ["port.exposed:tcp:6379", "high"],
      ["ssh.empty_passwords", "high"],
      ["ssh.root_password", "high"],
      ["ssh.password_auth", "medium"],
    ]);
    expect(got[1]!.title).toBe("Redis (tcp/6379) is reachable from the internet");
  });

  it("lowers severity on a private-only host and for limited or unknown reach", () => {
    const unread: AgentFirewall = { ...noFirewall, kind: "nftables", active: true };
    const ls = analyseListeners(
      [listener("tcp", "0.0.0.0", 5432), listener("tcp", "203.0.113.7", 27017)],
      unread,
    );
    const got = findings({ listeners: ls, firewall: unread, ssh: hardenedSsh, publicHost: false });
    expect(got.map((f) => [f.key, f.severity])).toEqual([
      // A specific public address is internet-facing even on a "private" host.
      ["port.exposed:tcp:27017", "medium"],
      ["port.exposed:tcp:5432", "low"],
    ]);

    const limited = firewalld([{ proto: "tcp", from: 3306, to: 3306, scope: "limited" }]);
    const l2 = analyseListeners([listener("tcp", "0.0.0.0", 3306)], limited);
    expect(
      findings({ listeners: l2, firewall: limited, ssh: hardenedSsh, publicHost: true }).map(
        (f) => f.severity,
      ),
    ).toEqual(["low"]);
  });

  it("only reports SSH settings when sshd listens", () => {
    const fw = firewalld([]);
    const weak: AgentSsh = { ...hardenedSsh, passwordAuthentication: "yes" };
    expect(findings({ listeners: [], firewall: fw, ssh: weak, publicHost: true })).toEqual([]);
    const ls = analyseListeners([listener("tcp", "0.0.0.0", 22)], fw);
    expect(
      findings({ listeners: ls, firewall: fw, ssh: weak, publicHost: true }).map((f) => f.key),
    ).toEqual(["ssh.password_auth"]);
    const pam: AgentSsh = { ...hardenedSsh, kbdInteractiveAuthentication: "yes" };
    expect(
      findings({ listeners: ls, firewall: fw, ssh: pam, publicHost: true }).map((f) => f.key),
    ).toEqual(["ssh.password_auth"]);
    const rootKey: AgentSsh = { ...hardenedSsh, permitRootLogin: "prohibit-password" };
    expect(
      findings({ listeners: ls, firewall: fw, ssh: rootKey, publicHost: true }).map((f) => [
        f.key,
        f.severity,
      ]),
    ).toEqual([["ssh.root_key", "low"]]);
  });

  it("flags a default-allow firewall and reports each port once", () => {
    const fw = firewalld([], { defaultAllow: true });
    const ls = analyseListeners(
      [listener("tcp", "0.0.0.0", 3306), listener("tcp", "::", 3306)],
      fw,
    );
    expect(
      findings({ listeners: ls, firewall: fw, ssh: hardenedSsh, publicHost: true }).map(
        (f) => f.key,
      ),
    ).toEqual(["port.exposed:tcp:3306", "firewall.default_allow"]);
  });

  it("counts open findings only", () => {
    expect(
      countOpen([
        { key: "a", severity: "high", title: "", detail: "", remedy: "", accepted: null },
        {
          key: "b",
          severity: "high",
          title: "",
          detail: "",
          remedy: "",
          accepted: { reason: "r", acceptedBy: "x", acceptedAt: new Date().toISOString() },
        },
        { key: "c", severity: "low", title: "", detail: "", remedy: "", accepted: null },
      ]),
    ).toEqual({ high: 1, medium: 0, low: 1 });
  });
});
