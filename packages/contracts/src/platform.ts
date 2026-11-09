import { z } from "zod";

export const DependencyStatusSchema = z.object({
  name: z.string(),
  status: z.enum(["up", "down", "not_configured"]),
  latencyMs: z.number().nullable(),
  detail: z.string().optional(),
});
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

export const HealthReportSchema = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  release: z.string(),
  uptimeSeconds: z.number(),
  checkedAt: z.iso.datetime(),
  dependencies: z.array(DependencyStatusSchema),
});
export type HealthReport = z.infer<typeof HealthReportSchema>;

/** Every number here is computed from the database at request time. */
export const DashboardSummarySchema = z.object({
  generatedAt: z.iso.datetime(),
  identities: z.object({ total: z.number(), active: z.number(), suspended: z.number() }),
  privileged: z.object({ total: z.number() }),
  signIns: z.object({
    last24h: z.number(),
    failedLast24h: z.number(),
    daily: z.array(z.object({ date: z.string(), success: z.number(), failure: z.number() })),
  }),
  roleDistribution: z.array(z.object({ role: z.string(), members: z.number() })),
  recentActivity: z.array(
    z.object({
      id: z.string(),
      occurredAt: z.iso.datetime(),
      action: z.string(),
      outcome: z.string(),
      actorLabel: z.string(),
      targetLabel: z.string().nullable(),
    }),
  ),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
