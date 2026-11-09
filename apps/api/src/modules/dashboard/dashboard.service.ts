import { Injectable } from "@nestjs/common";
import type { DashboardSummary } from "@nf/contracts";
import { DatabaseService } from "../../infra/database.service.js";

const DAY_MS = 86_400_000;
const PRIVILEGED_ROLE_KEYS = ["owner", "administrator"];

/** Aggregates computed live from the operational database. Nothing here is hardcoded. */
@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  async summary(tenantId: string): Promise<DashboardSummary> {
    const db = this.database.db;
    const now = new Date();
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 13 * DAY_MS,
    );

    const [statusCounts, privileged, signIns24h, failed24h, roleCounts, roles, recent, signInRows] =
      await Promise.all([
        db.identity.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
        db.identity.count({
          where: {
            tenantId,
            status: "active",
            roleAssignments: { some: { role: { key: { in: PRIVILEGED_ROLE_KEYS } } } },
          },
        }),
        db.auditEvent.count({
          where: { tenantId, action: "auth.sign_in", occurredAt: { gte: dayAgo } },
        }),
        db.auditEvent.count({
          where: { tenantId, action: "auth.sign_in_failed", occurredAt: { gte: dayAgo } },
        }),
        db.roleAssignment.groupBy({ by: ["roleId"], where: { tenantId }, _count: { _all: true } }),
        db.role.findMany({ where: { tenantId }, select: { id: true, name: true } }),
        db.auditEvent.findMany({ where: { tenantId }, orderBy: { id: "desc" }, take: 8 }),
        db.auditEvent.findMany({
          where: {
            tenantId,
            action: { in: ["auth.sign_in", "auth.sign_in_failed"] },
            occurredAt: { gte: start },
          },
          select: { action: true, occurredAt: true },
        }),
      ]);

    const byStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all]));
    const active = byStatus.active ?? 0;
    const suspended = byStatus.suspended ?? 0;

    const daily = Array.from({ length: 14 }, (_, i) => ({
      date: new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10),
      success: 0,
      failure: 0,
    }));
    const index = new Map(daily.map((d, i) => [d.date, i]));
    for (const row of signInRows) {
      const i = index.get(row.occurredAt.toISOString().slice(0, 10));
      if (i === undefined) continue;
      if (row.action === "auth.sign_in") daily[i]!.success++;
      else daily[i]!.failure++;
    }

    const roleName = new Map(roles.map((r) => [r.id, r.name]));
    return {
      generatedAt: now.toISOString(),
      identities: { total: active + suspended, active, suspended },
      privileged: { total: privileged },
      signIns: { last24h: signIns24h, failedLast24h: failed24h, daily },
      roleDistribution: roleCounts
        .map((r) => ({ role: roleName.get(r.roleId) ?? "Unknown", members: r._count._all }))
        .sort((a, b) => b.members - a.members),
      recentActivity: recent.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        action: e.action,
        outcome: e.outcome,
        actorLabel: e.actorLabel,
        targetLabel: e.targetLabel,
      })),
    };
  }
}
