"use client";

import { HealthReportSchema } from "@nf/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Database,
  KeyRound,
  type LucideIcon,
  RefreshCw,
  Server,
  Workflow,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, ForbiddenState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Badge, Card, Skeleton, StatusDot } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

const DEP: Record<string, { label: string; icon: LucideIcon; role: string }> = {
  mysql: { label: "MySQL", icon: Database, role: "Operational database" },
  redis: { label: "Redis", icon: Zap, role: "Rate limiting and caching" },
  sso: { label: "Single sign-on", icon: KeyRound, role: "OpenID Connect identity provider" },
  jobs: { label: "Background worker", icon: Workflow, role: "Job queue: directory sync" },
};

function uptime(seconds: number) {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function SystemHealth() {
  const { can } = usePermissions();
  const health = useQuery({
    queryKey: ["system-health"],
    queryFn: () => api("/api/v1/system/health", { schema: HealthReportSchema }),
    enabled: can("system.health.read"),
    refetchInterval: 15_000,
  });
  if (!can("system.health.read")) return <ForbiddenState permission="system.health.read" />;
  const h = health.data;
  const overall = {
    ok: { text: "All systems operational", tone: "success" as const, ring: "from-success/25" },
    degraded: { text: "Degraded performance", tone: "warning" as const, ring: "from-warning/25" },
    down: { text: "Service disruption", tone: "danger" as const, ring: "from-danger/25" },
  };

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="System health"
        description="Live checks of the services Neural Frontier depends on. Refreshes every 15 seconds."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void health.refetch()}
            loading={health.isFetching}
          >
            <RefreshCw /> Refresh
          </Button>
        }
      />
      {health.isError ? (
        <Card>
          <ErrorState error={health.error} onRetry={() => void health.refetch()} />
        </Card>
      ) : !h ? (
        <div className="space-y-4">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <Card className="relative overflow-hidden p-6 sm:p-8">
            <div
              aria-hidden
              className={cn(
                "absolute -left-24 -top-24 size-72 rounded-full bg-gradient-to-br to-transparent blur-2xl",
                overall[h.status].ring,
              )}
            />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <span className="grid size-12 place-items-center rounded-2xl bg-surface-sunken ring-1 ring-inset ring-border">
                  <Server className="size-5 text-muted" aria-hidden />
                </span>
                <div>
                  <div className="flex items-center gap-2.5">
                    <StatusDot tone={overall[h.status].tone} />
                    <p className="text-lg font-semibold tracking-tight">{overall[h.status].text}</p>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">
                    Checked {formatRelative(h.checkedAt)}
                  </p>
                </div>
              </div>
              <dl className="flex gap-8 text-[13px]">
                <div>
                  <dt className="text-subtle">Release</dt>
                  <dd className="mt-0.5 font-mono font-medium">{h.release.slice(0, 12)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">API uptime</dt>
                  <dd data-numeric className="mt-0.5 font-medium">
                    {uptime(h.uptimeSeconds)}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            {h.dependencies.map((d) => {
              const meta = DEP[d.name] ?? { label: d.name, icon: Server, role: "" };
              const tone =
                d.status === "up" ? "success" : d.status === "down" ? "danger" : "neutral";
              return (
                <Card key={d.name} className="p-5">
                  <div className="flex items-start justify-between">
                    <span className="grid size-10 place-items-center rounded-xl bg-surface-sunken ring-1 ring-inset ring-border">
                      <meta.icon className="size-[18px] text-muted" aria-hidden />
                    </span>
                    <Badge tone={tone === "neutral" ? "neutral" : tone} dot>
                      {d.status === "not_configured"
                        ? "Not configured"
                        : d.status === "up"
                          ? "Operational"
                          : "Down"}
                    </Badge>
                  </div>
                  <p className="mt-4 text-[15px] font-semibold tracking-tight">{meta.label}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted">{meta.role}</p>
                  <div className="mt-4 border-t border-border pt-3 text-[12.5px]">
                    {d.latencyMs !== null ? (
                      <span className="text-subtle">
                        Latency{" "}
                        <span data-numeric className="font-mono font-medium text-foreground">
                          {d.latencyMs} ms
                        </span>
                      </span>
                    ) : (
                      <span className="text-subtle">{d.detail ?? "—"}</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
