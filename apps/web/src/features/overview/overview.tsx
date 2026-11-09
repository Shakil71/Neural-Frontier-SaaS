"use client";

import { DashboardSummarySchema, HealthReportSchema, type DashboardSummary } from "@nf/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  KeyRound,
  type LucideIcon,
  ShieldCheck,
  UserX,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback } from "react";
import { EChart, type ChartTokens, withAlpha } from "@/components/charts/echart";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/states/states";
import { Badge, Card, CardBody, CardHeader, Skeleton, StatusDot } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { auditLabel } from "@/lib/audit-labels";
import { cn } from "@/lib/cn";
import { formatNumber, formatRelative } from "@/lib/format";
import { usePermissions } from "@/lib/session";

function greeting(name: string) {
  const h = new Date().getHours();
  const part =
    h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(" ")[0]}`;
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  index,
}: {
  label: string;
  value: number | undefined;
  hint: string;
  icon: LucideIcon;
  tone: "primary" | "accent" | "warning" | "danger";
  index: number;
}) {
  const tint = {
    primary: "bg-primary-soft text-primary",
    accent: "bg-accent-soft text-accent",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className="group relative overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-card"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-[radial-gradient(closest-side,var(--primary-soft),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
      />
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className={cn("grid size-8 place-items-center rounded-lg", tint)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {value === undefined ? (
        <Skeleton className="mt-4 h-9 w-24" />
      ) : (
        <p data-numeric className="mt-3 text-[32px] font-semibold leading-none tracking-[-0.03em]">
          {formatNumber(value)}
        </p>
      )}
      <p className="mt-2.5 text-[12.5px] text-subtle">{hint}</p>
    </motion.div>
  );
}

function SignInTrend({ data }: { data: DashboardSummary["signIns"]["daily"] }) {
  const build = useCallback(
    (t: ChartTokens) => ({
      grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: data.map((d) =>
          new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }),
        ),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.subtle, fontSize: 11, margin: 12 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitLine: { lineStyle: { color: t.border, type: "dashed" } },
        axisLabel: { color: t.subtle, fontSize: 11 },
      },
      series: [
        {
          name: "Successful",
          type: "line",
          smooth: 0.35,
          symbol: "circle",
          symbolSize: 6,
          showSymbol: false,
          data: data.map((d) => d.success),
          lineStyle: { width: 2.5, color: t.chart1 },
          itemStyle: { color: t.chart1 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(t.chart1, 0.32) },
                { offset: 1, color: withAlpha(t.chart1, 0) },
              ],
            },
          },
        },
        {
          name: "Failed",
          type: "line",
          smooth: 0.35,
          showSymbol: false,
          data: data.map((d) => d.failure),
          lineStyle: { width: 2, color: t.danger, type: "dashed" },
          itemStyle: { color: t.danger },
        },
      ],
    }),
    [data],
  );
  return (
    <EChart
      build={build}
      height={250}
      ariaLabel="Daily successful and failed sign-ins over the last 14 days"
    />
  );
}

function RoleDonut({ data }: { data: DashboardSummary["roleDistribution"] }) {
  const build = useCallback(
    (t: ChartTokens) => ({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      color: [t.chart1, t.chart2, t.chart3, t.chart4, t.chart5],
      series: [
        {
          type: "pie",
          radius: ["62%", "86%"],
          padAngle: 3,
          itemStyle: { borderRadius: 6 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 4 },
          data: data.map((d) => ({ name: d.role, value: d.members })),
        },
      ],
    }),
    [data],
  );
  return <EChart build={build} height={180} ariaLabel="Role assignments by role" />;
}

function PlatformHealth() {
  const { can } = usePermissions();
  const health = useQuery({
    queryKey: ["system-health"],
    queryFn: () => api("/api/v1/system/health", { schema: HealthReportSchema }),
    enabled: can("system.health.read"),
    refetchInterval: 30_000,
  });
  if (!can("system.health.read")) return null;
  const tone = (s: string) =>
    (s === "up" ? "success" : s === "down" ? "danger" : "neutral") as
      "success" | "danger" | "neutral";
  return (
    <Card>
      <CardHeader
        title="Platform health"
        description="Live dependency checks"
        action={
          <Link
            href="/system"
            className="rounded-md p-1 text-subtle hover:text-foreground"
            aria-label="Open system health"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        }
      />
      <CardBody className="space-y-2.5">
        {health.isPending &&
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)}
        {health.isError && <ErrorState error={health.error} className="py-6" />}
        {health.data?.dependencies.map((d) => (
          <div
            key={d.name}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken/50 px-3.5 py-2.5"
          >
            <StatusDot tone={tone(d.status)} />
            <span className="flex-1 text-[13px] font-medium capitalize">
              {d.name === "sso" ? "Single sign-on" : d.name}
            </span>
            <span className="font-mono text-[11.5px] text-subtle">
              {d.status === "up" && d.latencyMs !== null
                ? `${d.latencyMs} ms`
                : d.status.replace("_", " ")}
            </span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export function Overview() {
  const { can, session } = usePermissions();
  const summary = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api("/api/v1/dashboard/summary", { schema: DashboardSummarySchema }),
    enabled: can("identities.read"),
    refetchInterval: 60_000,
  });

  if (!can("identities.read")) return <ForbiddenState permission="identities.read" />;
  const s = summary.data;

  return (
    <>
      <PageHeader
        eyebrow={session?.tenant.name}
        title={session ? greeting(session.user.displayName) : "Overview"}
        description="Live identity and access posture for your organisation."
        actions={
          s && (
            <Badge tone="success" dot>
              Updated {formatRelative(s.generatedAt)}
            </Badge>
          )
        }
      />

      {summary.isError ? (
        <Card>
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              index={0}
              label="Identities"
              value={s?.identities.total}
              hint={s ? `${formatNumber(s.identities.active)} active` : " "}
              icon={Users}
              tone="primary"
            />
            <Kpi
              index={1}
              label="Privileged access"
              value={s?.privileged.total}
              hint="Active owners and administrators"
              icon={ShieldCheck}
              tone="accent"
            />
            <Kpi
              index={2}
              label="Sign-ins · 24h"
              value={s?.signIns.last24h}
              hint={s ? `${formatNumber(s.signIns.failedLast24h)} failed attempts` : " "}
              icon={KeyRound}
              tone={s && s.signIns.failedLast24h > 0 ? "warning" : "primary"}
            />
            <Kpi
              index={3}
              label="Suspended"
              value={s?.identities.suspended}
              hint="Blocked from signing in"
              icon={UserX}
              tone="danger"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Sign-in activity"
                description="Successful and failed sign-ins, last 14 days (UTC)"
                action={
                  <div className="flex items-center gap-4 text-[12px] text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-3.5 rounded bg-[var(--chart-1)]" />
                      Successful
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-3.5 rounded border-t-2 border-dashed border-danger" />
                      Failed
                    </span>
                  </div>
                }
              />
              <CardBody className="pt-3">
                {s ? <SignInTrend data={s.signIns.daily} /> : <Skeleton className="h-[250px]" />}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Access by role" description="Role assignments across identities" />
              <CardBody>
                {!s ? (
                  <Skeleton className="h-[260px]" />
                ) : s.roleDistribution.length === 0 ? (
                  <EmptyState icon={ShieldCheck} title="No role assignments yet" className="py-8" />
                ) : (
                  <>
                    <RoleDonut data={s.roleDistribution} />
                    <ul className="mt-4 space-y-2">
                      {s.roleDistribution.map((r, i) => (
                        <li key={r.role} className="flex items-center gap-2.5 text-[13px]">
                          <span
                            className="size-2.5 rounded-sm"
                            style={{ background: `var(--chart-${(i % 5) + 1})` }}
                            aria-hidden
                          />
                          <span className="flex-1 text-muted">{r.role}</span>
                          <span data-numeric className="font-medium">
                            {r.members}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Recent activity"
                description="Latest events from the audit log"
                action={
                  can("audit.read") && (
                    <Link
                      href="/audit"
                      className="text-[12.5px] font-medium text-primary hover:underline"
                    >
                      View audit log
                    </Link>
                  )
                }
              />
              <CardBody className="pt-3">
                {!s ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Skeleton key={i} className="h-11" />
                    ))}
                  </div>
                ) : s.recentActivity.length === 0 ? (
                  <EmptyState icon={Activity} title="No activity yet" className="py-8">
                    Events appear here as people sign in and administrators make changes.
                  </EmptyState>
                ) : (
                  <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[19px] before:top-3 before:w-px before:bg-border">
                    {s.recentActivity.map((e) => {
                      const meta = auditLabel(e.action);
                      const tone = {
                        neutral: "text-muted bg-surface-sunken",
                        primary: "text-primary bg-primary-soft",
                        warning: "text-warning bg-warning-soft",
                        danger: "text-danger bg-danger-soft",
                      }[meta.tone];
                      return (
                        <li
                          key={e.id}
                          className="relative flex items-center gap-3.5 rounded-lg px-1 py-2"
                        >
                          <span
                            className={cn(
                              "relative grid size-[38px] shrink-0 place-items-center rounded-full ring-4 ring-surface",
                              tone,
                            )}
                          >
                            <meta.icon className="size-4" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px]">
                              <span className="font-medium">{meta.label}</span>
                              {e.targetLabel && (
                                <span className="text-muted"> · {e.targetLabel}</span>
                              )}
                            </p>
                            <p className="truncate text-[12px] text-subtle">by {e.actorLabel}</p>
                          </div>
                          <time
                            dateTime={e.occurredAt}
                            className="shrink-0 text-[12px] text-subtle"
                          >
                            {formatRelative(e.occurredAt)}
                          </time>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardBody>
            </Card>
            <PlatformHealth />
          </div>
        </div>
      )}
    </>
  );
}
