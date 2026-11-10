"use client";

import { FleetUpdatesSchema, type ServerSummary } from "@nf/contracts";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, RefreshCcw, ServerCog } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatNumber, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";
import { severityTone, UpdatesBadge } from "./patches";
import { ServerSheet } from "./servers";

export const updateKeys = { fleet: ["server-updates"] as const };

type Summary = NonNullable<ServerSummary["updates"]>;

/* ── Page ─────────────────────────────────────────────────────────────── */

export function Updates() {
  const { can } = usePermissions();
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: updateKeys.fleet,
    queryFn: () => api("/api/v1/server-updates", { schema: FleetUpdatesSchema }),
    enabled: can("servers.read"),
    refetchInterval: 60_000,
  });
  if (!can("servers.read")) return <ForbiddenState permission="servers.read" />;
  const d = q.data;
  const rank = (u: Summary | null) =>
    !u ? 5 : u.status !== "ok" ? 4 : u.urgent ? 0 : u.security ? 1 : u.rebootRequired ? 2 : 3;
  const servers = [...(d?.servers ?? [])].sort(
    (a, b) => rank(a.updates) - rank(b.updates) || a.hostname.localeCompare(b.hostname),
  );

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Updates"
        description="Patch compliance across your servers: security updates waiting to be installed, servers that need a reboot to run an installed kernel, and package information that has gone stale. Checked hourly by each agent from the server's own package cache."
      />
      {q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : q.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : d!.totals.servers === 0 ? (
        <Card>
          <EmptyState
            icon={ServerCog}
            title="No servers yet"
            action={
              <Button asChild variant="secondary">
                <Link href="/servers">Go to Servers</Link>
              </Button>
            }
          >
            Add a Linux server with the agent; its pending updates are tracked here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: "Up to date",
                value: `${formatNumber(d!.totals.upToDate)}`,
                suffix: ` / ${formatNumber(d!.totals.reporting)}`,
                tone: "text-success",
                bar: "bg-success",
              },
              {
                label: "Need security updates",
                value: formatNumber(d!.totals.withSecurity),
                tone: d!.totals.withSecurity ? "text-danger" : "",
                bar: "bg-danger",
              },
              {
                label: "Need a reboot",
                value: formatNumber(d!.totals.rebootRequired),
                tone: d!.totals.rebootRequired ? "text-warning" : "",
                bar: "bg-warning",
              },
              {
                label: "Security updates waiting",
                value: formatNumber(d!.totals.securityUpdates),
                bar: "bg-primary",
              },
            ].map((c, i) => (
              <Card
                key={c.label}
                className="relative overflow-hidden p-5"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", c.bar)} />
                <p className="text-[12px] text-subtle">{c.label}</p>
                <p
                  data-numeric
                  className={cn("mt-1 text-[26px] font-semibold tracking-tight", c.tone)}
                >
                  {c.value}
                  {c.suffix && (
                    <span className="text-[15px] font-normal text-subtle">{c.suffix}</span>
                  )}
                </p>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-border bg-surface-sunken/60 text-[11.5px] uppercase tracking-wide text-subtle">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Server</th>
                      <th className="px-4 py-2.5 font-medium">State</th>
                      <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Pending</th>
                      <th className="hidden px-4 py-2.5 font-medium md:table-cell">Checked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {servers.map((s) => (
                      <tr key={s.serverId} className="transition-colors hover:bg-surface-sunken/50">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setOpenId(s.serverId)}
                            className="rounded font-mono text-[12.5px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          >
                            {s.hostname}
                          </button>
                          <p className="truncate text-[11.5px] text-subtle">{s.os ?? "—"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <UpdatesBadge u={s.updates} />
                            {s.updates?.status === "ok" &&
                              s.updates.security > 0 &&
                              s.updates.rebootRequired && (
                                <Badge tone="warning">
                                  <RefreshCcw className="size-3" aria-hidden /> Reboot
                                </Badge>
                              )}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell" data-numeric>
                          {s.updates?.status === "ok" ? formatNumber(s.updates.pending) : "—"}
                        </td>
                        <td className="hidden px-4 py-3 text-[12px] text-muted md:table-cell">
                          {s.updates ? formatRelative(s.updates.checkedAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d!.totals.reporting < d!.totals.servers && (
                <p className="border-t border-border px-4 py-3 text-[12px] text-subtle">
                  {d!.totals.servers - d!.totals.reporting} of {d!.totals.servers} servers
                  don&apos;t report updates yet: their agent predates it or their package manager
                  couldn&apos;t be asked. Run the install command on them again to update the agent.
                </p>
              )}
            </Card>

            <Card className="h-fit p-5">
              <h2 className="text-[14px] font-semibold">Most needed security updates</h2>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Across your servers, most urgent first.
              </p>
              {d!.topPackages.length === 0 ? (
                <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
                  <CircleCheck className="size-4 text-success" aria-hidden /> No security updates
                  are waiting.
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {d!.topPackages.map((p) => (
                    <li
                      key={p.name}
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[12px] font-medium">{p.name}</p>
                        <p className="truncate text-[11px] text-subtle">
                          {p.advisory || "security update"} · {p.servers}{" "}
                          {p.servers === 1 ? "server" : "servers"}
                        </p>
                      </div>
                      {p.severity && <Badge tone={severityTone(p.severity)}>{p.severity}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
      <ServerSheet
        key={openId ?? "closed"}
        id={openId}
        initialTab="updates"
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
