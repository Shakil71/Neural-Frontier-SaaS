"use client";

import { type FindingSeverity, TenantFindingsSchema } from "@nf/contracts";
import { useQuery } from "@tanstack/react-query";
import { ServerCog, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { usePermissions } from "@/lib/session";
import { exposureKeys, FindingItem, SEVERITY } from "./exposure";
import { ServerSheet } from "./servers";

type Filter = "open" | FindingSeverity | "accepted";

export function Exposure() {
  const { can } = usePermissions();
  const [filter, setFilter] = useState<Filter>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: exposureKeys.findings,
    queryFn: () => api("/api/v1/server-findings", { schema: TenantFindingsSchema }),
    enabled: can("servers.read"),
    refetchInterval: 60_000,
  });
  if (!can("servers.read")) return <ForbiddenState permission="servers.read" />;
  const d = q.data;
  const items =
    d?.items.filter((i) =>
      filter === "accepted"
        ? i.accepted
        : !i.accepted && (filter === "open" || i.severity === filter),
    ) ?? [];
  const openTotal = d ? d.open.high + d.open.medium + d.open.low : 0;
  const filters: { id: Filter; label: string; count: number }[] = d
    ? [
        { id: "open", label: "All open", count: openTotal },
        { id: "high", label: "High", count: d.open.high },
        { id: "medium", label: "Medium", count: d.open.medium },
        { id: "low", label: "Low", count: d.open.low },
        { id: "accepted", label: "Accepted", count: d.accepted },
      ]
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Security findings"
        description="What needs attention on your servers: sensitive services reachable from the network, missing or permissive firewalls, SSH settings that invite password guessing, security updates waiting and reboots needed. Worked out from each agent's latest report."
      />

      {q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : q.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : d!.serversTotal === 0 || d!.serversReporting === 0 ? (
        <Card>
          <EmptyState
            icon={ServerCog}
            title={d!.serversTotal === 0 ? "No servers yet" : "No server reports exposure yet"}
            action={
              <Button asChild variant="secondary">
                <Link href="/servers">Go to Servers</Link>
              </Button>
            }
          >
            {d!.serversTotal === 0
              ? "Add a server or computer with the agent; its listening ports, firewall, SSH and Windows protection settings are analysed here."
              : "Your servers run an agent from before exposure reporting. Run the install command on them again to update; findings appear after the next report."}
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["high", "medium", "low"] as const).map((k, i) => (
              <Card
                key={k}
                className="relative overflow-hidden p-5"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span
                  aria-hidden
                  className={cn("absolute inset-x-0 top-0 h-0.5", SEVERITY[k].bar)}
                />
                <p className="text-[12px] text-subtle">{SEVERITY[k].label} severity</p>
                <p
                  data-numeric
                  className={cn(
                    "mt-1 text-[26px] font-semibold tracking-tight",
                    d!.open[k] > 0 && k === "high" && "text-danger",
                    d!.open[k] > 0 && k === "medium" && "text-warning",
                  )}
                >
                  {formatNumber(d!.open[k])}
                </p>
              </Card>
            ))}
            <Card className="p-5" style={{ animationDelay: "120ms" }}>
              <p className="text-[12px] text-subtle">Servers analysed</p>
              <p data-numeric className="mt-1 text-[26px] font-semibold tracking-tight">
                {formatNumber(d!.serversReporting)}
                <span className="text-[15px] font-normal text-subtle">
                  {" "}
                  / {formatNumber(d!.serversTotal)}
                </span>
              </p>
            </Card>
          </div>

          <div role="tablist" aria-label="Filter findings" className="mb-4 flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30",
                  filter === f.id
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                {f.label} <span className="text-subtle">{formatNumber(f.count)}</span>
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <Card>
              <EmptyState
                icon={ShieldCheck}
                title={filter === "accepted" ? "Nothing accepted" : "No open findings"}
              >
                {filter === "accepted"
                  ? "Findings an administrator accepts, with the reason, are listed here."
                  : "None of the analysed servers exposes a sensitive service, and SSH and the firewalls are configured well."}
              </EmptyState>
            </Card>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {items.map((f) => (
                <FindingItem
                  key={`${f.serverId}:${f.key}`}
                  finding={f}
                  serverId={f.serverId}
                  hostname={f.hostname}
                  canManage={can("servers.manage")}
                  showHost
                  onOpenServer={() => setOpenId(f.serverId)}
                />
              ))}
            </ul>
          )}
        </>
      )}
      <ServerSheet
        key={openId ?? "closed"}
        id={openId}
        initialTab="security"
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
