import type { AgentUpdates, FindingSeverity, ServerFinding, ServerSummary } from "@nf/contracts";

/**
 * Patch compliance (Phase 4b). Pure functions over the agent's update report: a summary for
 * lists and findings for what needs doing. No I/O, unit-tested.
 */

const DAY_MS = 86_400_000;
/** Metadata older than this makes "up to date" unreliable. */
export const STALE_METADATA_DAYS = 7;

const URGENT = new Set(["critical", "important"]);

export function isUrgent(severity: string): boolean {
  return URGENT.has(severity.toLowerCase());
}

export function updatesSummary(u: AgentUpdates): NonNullable<ServerSummary["updates"]> {
  const security = u.pending.filter((p) => p.security);
  return {
    status: u.status,
    pending: u.pending.length,
    security: security.length,
    urgent: security.filter((p) => isUrgent(p.severity)).length,
    rebootRequired: u.rebootRequired,
    checkedAt: u.checkedAt,
    metadataAt: u.metadataAt,
  };
}

export function metadataAgeDays(u: AgentUpdates): number | null {
  if (!u.metadataAt) return null;
  return Math.floor((Date.parse(u.checkedAt) - Date.parse(u.metadataAt)) / DAY_MS);
}

function severityOf(securityUpdates: AgentUpdates["pending"]): FindingSeverity {
  const ranks = securityUpdates.map((p) => p.severity.toLowerCase());
  if (ranks.some((r) => URGENT.has(r))) return "high";
  // Debian and Ubuntu don't rate their security updates; treat them as medium.
  if (ranks.some((r) => r === "moderate" || r === "")) return "medium";
  return "low";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Draft = Omit<ServerFinding, "accepted">;

export function updateFindings(u: AgentUpdates): Draft[] {
  if (u.status !== "ok") return [];
  const out: Draft[] = [];
  const security = u.pending.filter((p) => p.security);
  if (security.length > 0) {
    const named = security
      .slice(0, 3)
      .map((p) => {
        // Windows update titles already name their KB article.
        const advisory = p.advisory && !p.name.includes(p.advisory) ? p.advisory : "";
        const extra = [advisory, p.severity].filter(Boolean).join(", ");
        return extra ? `${p.name} (${extra})` : p.name;
      })
      .join(", ");
    const more = security.length > 3 ? ` and ${security.length - 3} more` : "";
    out.push({
      key: "updates.security",
      severity: severityOf(security),
      title: `${plural(security.length, "security update is", "security updates are")} waiting`,
      detail: `${named}${more}.`,
      remedy:
        u.manager === "windows-update"
          ? "Install them with Windows Update (Settings → Windows Update), then restart when it asks."
          : u.manager === "dpkg"
            ? "Install them with apt upgrade (or unattended-upgrades), then restart affected services."
            : "Install them with dnf upgrade --security, then restart affected services or reboot if the kernel changed.",
    });
  }
  if (u.rebootRequired) {
    out.push({
      key: "updates.reboot_required",
      severity: "medium",
      title: "A reboot is needed to finish updating",
      detail:
        u.newestKernel && u.newestKernel !== u.runningKernel
          ? `Running kernel ${u.runningKernel}; ${u.newestKernel} is installed but not in use, so its fixes aren't active.`
          : "The system reports that updates installed since the last boot need a restart.",
      remedy:
        u.manager === "windows-update"
          ? "Restart the computer in a maintenance window."
          : "Reboot the server in a maintenance window.",
    });
  }
  const age = metadataAgeDays(u);
  if (age !== null && age >= STALE_METADATA_DAYS) {
    out.push({
      key: "updates.stale_metadata",
      severity: "low",
      title:
        u.manager === "windows-update"
          ? `Windows Update last checked ${age} days ago`
          : `Package information is ${age} days old`,
      detail:
        "Updates published since then aren't known to this server, so it may look more up to date than it is.",
      remedy:
        u.manager === "windows-update"
          ? "Make sure Windows Update checks automatically and can reach Microsoft Update or your update server."
          : u.manager === "dpkg"
            ? "Make sure apt's daily update runs (apt-daily.timer) and can reach its mirrors."
            : "Make sure dnf-makecache.timer is enabled and can reach its repositories.",
    });
  }
  return out;
}
