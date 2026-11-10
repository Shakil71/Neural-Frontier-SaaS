import type { AgentUpdates } from "@nf/contracts";
import { describe, expect, it } from "vitest";
import { metadataAgeDays, updateFindings, updatesSummary } from "./patches.js";

const base: AgentUpdates = {
  status: "ok",
  error: "",
  manager: "rpm",
  checkedAt: "2026-11-10T18:00:00Z",
  metadataAt: "2026-11-10T17:00:00Z",
  pending: [],
  rebootRequired: false,
  runningKernel: "5.15.0-326.222.4.el9uek.x86_64",
  newestKernel: "5.15.0-326.222.4.el9uek.x86_64",
};

const pkg = (name: string, security: boolean, severity = "", advisory = "") => ({
  name,
  arch: "x86_64",
  version: "1.0-1.el9",
  security,
  severity,
  advisory,
});

describe("patch compliance", () => {
  it("an up-to-date server has no findings", () => {
    expect(updateFindings(base)).toEqual([]);
    expect(updatesSummary(base)).toMatchObject({ pending: 0, security: 0, urgent: 0 });
  });

  it("rates security updates by their most severe advisory", () => {
    const u = {
      ...base,
      pending: [
        pkg("openssl", true, "Important", "ELSA-2026-1"),
        pkg("curl", true, "Moderate", "ELSA-2026-2"),
        pkg("tzdata", false),
      ],
    };
    const [f] = updateFindings(u);
    expect(f).toMatchObject({
      key: "updates.security",
      severity: "high",
      title: "2 security updates are waiting",
      detail: "openssl (ELSA-2026-1, Important), curl (ELSA-2026-2, Moderate).",
    });
    expect(f!.remedy).toContain("dnf upgrade --security");
    expect(updatesSummary(u)).toMatchObject({ pending: 3, security: 2, urgent: 1 });

    expect(updateFindings({ ...base, pending: [pkg("curl", true, "Moderate")] })[0]!.severity).toBe(
      "medium",
    );
    expect(updateFindings({ ...base, pending: [pkg("vim", true, "Low")] })[0]!.severity).toBe(
      "low",
    );
  });

  it("treats unrated Debian security updates as medium and names the rest", () => {
    const u: AgentUpdates = {
      ...base,
      manager: "dpkg",
      pending: ["a", "b", "c", "d", "e"].map((n) => pkg(n, true)),
    };
    const [f] = updateFindings(u);
    expect(f).toMatchObject({ severity: "medium", detail: "a, b, c and 2 more." });
    expect(f!.remedy).toContain("apt upgrade");
  });

  it("asks for a reboot when a newer kernel is installed but not running", () => {
    const u = {
      ...base,
      rebootRequired: true,
      runningKernel: "5.15.0-325.221.6.6.el9uek.x86_64",
    };
    expect(updateFindings(u)).toEqual([
      expect.objectContaining({
        key: "updates.reboot_required",
        severity: "medium",
        detail: expect.stringContaining(
          "5.15.0-326.222.4.el9uek.x86_64 is installed but not in use",
        ),
      }),
    ]);
    const deb = { ...base, manager: "dpkg" as const, rebootRequired: true, newestKernel: "" };
    expect(updateFindings(deb)[0]!.detail).toContain("need a restart");
  });

  it("warns when the package metadata is stale", () => {
    const u = { ...base, metadataAt: "2026-10-30T18:00:00Z" };
    expect(metadataAgeDays(u)).toBe(11);
    expect(updateFindings(u)).toEqual([
      expect.objectContaining({ key: "updates.stale_metadata", severity: "low" }),
    ]);
    expect(updateFindings({ ...u, metadataAt: "2026-11-05T18:00:00Z" })).toEqual([]);
  });

  it("says nothing when the package manager couldn't answer", () => {
    const u: AgentUpdates = {
      ...base,
      status: "unavailable",
      error: "Read-only file system",
      pending: [pkg("openssl", true, "Critical")],
      rebootRequired: true,
    };
    expect(updateFindings(u)).toEqual([]);
  });
});
