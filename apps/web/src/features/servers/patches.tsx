"use client";

import type { AgentPendingUpdate, ServerDetail, ServerSummary } from "@nf/contracts";
import {
  CircleAlert,
  CircleCheck,
  PackageCheck,
  PackageOpen,
  RefreshCcw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Badge, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { FindingItem } from "./exposure";

type Summary = NonNullable<ServerSummary["updates"]>;

const SEVERITY_TONE: Record<string, "danger" | "warning" | "primary" | "neutral"> = {
  critical: "danger",
  important: "danger",
  moderate: "warning",
  low: "primary",
};

export function severityTone(severity: string) {
  return SEVERITY_TONE[severity.toLowerCase()] ?? "warning";
}

/** One-word state of a server's patches, for badges. */
export function UpdatesBadge({ u }: { u: Summary | null }) {
  if (!u) return <span className="text-[12px] text-subtle">Not reported</span>;
  if (u.status !== "ok") {
    return (
      <Badge tone="neutral">
        <CircleAlert className="size-3" aria-hidden /> Can&apos;t check
      </Badge>
    );
  }
  if (u.security > 0) {
    return (
      <Badge tone={u.urgent > 0 ? "danger" : "warning"}>
        <ShieldAlert className="size-3" aria-hidden /> {u.security} security
      </Badge>
    );
  }
  if (u.rebootRequired) {
    return (
      <Badge tone="warning">
        <RefreshCcw className="size-3" aria-hidden /> Reboot needed
      </Badge>
    );
  }
  if (u.pending > 0) return <Badge tone="primary">{u.pending} updates</Badge>;
  return (
    <Badge tone="success">
      <CircleCheck className="size-3" aria-hidden /> Up to date
    </Badge>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-sunken/60 p-3.5">
      <p className="text-[11.5px] text-subtle">{label}</p>
      <p className={cn("mt-1 text-[18px] font-semibold tracking-tight", tone)} data-numeric>
        {value}
      </p>
      {sub && <p className="truncate text-[11.5px] text-muted">{sub}</p>}
    </div>
  );
}

/** The Updates tab of the server panel. */
export function PatchPanel({ s, canManage }: { s: ServerDetail; canManage: boolean }) {
  const [filter, setFilter] = useState("");
  const q = useDeferredValue(filter.trim().toLowerCase());
  const u = s.patches;
  const rows = useMemo(
    () =>
      (u?.pending ?? []).filter(
        (p: AgentPendingUpdate) =>
          !q || `${p.name} ${p.version} ${p.advisory}`.toLowerCase().includes(q),
      ),
    [u, q],
  );
  if (!u) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong p-5 text-center">
        <PackageOpen className="mx-auto size-6 text-subtle" aria-hidden />
        <p className="mt-2 text-[13px] font-medium">No update data from this server yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted">
          {s.status === "retired"
            ? "Retired servers aren't analysed."
            : "Its agent predates patch reporting. Run the install command (Add server) on it again to update the agent; the next report fills this in."}
        </p>
      </div>
    );
  }
  if (u.status !== "ok") {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning-soft p-4 text-[12.5px]">
        <p className="flex items-center gap-2 font-medium">
          <CircleAlert className="size-4 text-warning" aria-hidden />
          {u.status === "unsupported"
            ? "This distribution's package manager isn't supported yet"
            : "The package manager couldn't be asked"}
        </p>
        {u.error && <p className="mt-1.5 font-mono text-[11.5px] text-muted">{u.error}</p>}
        <p className="mt-1.5 text-muted">
          Nothing is shown as up to date until it answers. Checked{" "}
          {formatRelative(u.checkedAt).toLowerCase()}.
        </p>
      </div>
    );
  }
  const security = u.pending.filter((p) => p.security).length;
  const ageDays = u.metadataAt
    ? Math.floor((Date.parse(u.checkedAt) - Date.parse(u.metadataAt)) / 86_400_000)
    : null;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Security updates"
          value={formatNumber(security)}
          sub={security ? "waiting to be installed" : "none waiting"}
          tone={security ? "text-danger" : "text-success"}
        />
        <Stat
          label="All updates"
          value={formatNumber(u.pending.length)}
          sub={`${u.manager === "dpkg" ? "apt" : "dnf"} · checked ${formatRelative(u.checkedAt).toLowerCase()}`}
        />
        <Stat
          label="Reboot"
          value={u.rebootRequired === null ? "—" : u.rebootRequired ? "Needed" : "Not needed"}
          sub={u.runningKernel ? `running ${u.runningKernel}` : undefined}
          tone={u.rebootRequired ? "text-warning" : undefined}
        />
      </div>

      {s.patchFindings.length > 0 && (
        <ul className="space-y-2.5" aria-label="Update findings">
          {s.patchFindings.map((f) => (
            <FindingItem
              key={f.key}
              finding={f}
              serverId={s.id}
              hostname={s.hostname}
              canManage={canManage}
            />
          ))}
        </ul>
      )}

      <section aria-label="Pending updates" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-semibold">Pending updates</h3>
          <p className="text-[11.5px] text-subtle">
            Package information from{" "}
            {u.metadataAt ? formatDateTime(u.metadataAt) : "an unknown time"}
            {ageDays !== null && ageDays >= 1
              ? ` (${ageDays} ${ageDays === 1 ? "day" : "days"} old)`
              : ""}
          </p>
        </div>
        {u.pending.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-soft px-3.5 py-3 text-[12.5px]">
            <PackageCheck className="size-4 text-success" aria-hidden /> Every installed package is
            at its newest available version.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by package or advisory"
                aria-label="Filter pending updates"
                className="pl-9"
              />
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {rows.slice(0, 300).map((p) => (
                <li key={`${p.name}.${p.arch}`} className="flex items-center gap-3 px-3.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[12px]">
                      {p.name}
                      <span className="text-subtle">.{p.arch}</span>
                    </p>
                    <p className="truncate text-[11.5px] text-subtle">{p.version}</p>
                  </div>
                  {p.security ? (
                    <Badge tone={p.severity ? severityTone(p.severity) : "warning"}>
                      {p.severity || "Security"}
                      {p.advisory ? ` · ${p.advisory}` : ""}
                    </Badge>
                  ) : (
                    <span className="text-[11.5px] text-subtle">Update</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-subtle">
              Showing {formatNumber(Math.min(300, rows.length))} of {formatNumber(rows.length)}
              {q ? " matches" : ""}.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
