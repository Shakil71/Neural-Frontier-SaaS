import { Injectable } from "@nestjs/common";
import type { AuditAction, AuditEvent, AuditOutcome, AuditQuery, CursorPage } from "@nf/contracts";
import type { Prisma, ScopedTransaction } from "@nf/db";
import type { RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";

export interface AuditRecord {
  tenantId: string | null;
  action: AuditAction;
  outcome: AuditOutcome;
  actor: { id: string | null; label: string };
  target?: { type: string; id: string; label?: string | null } | null;
  meta?: RequestMeta;
  metadata?: Record<string, unknown>;
}

type Writer = Pick<ScopedTransaction, "auditEvent">;

/**
 * Append-only audit trail. Pass `tx` to record inside the same transaction as the
 * change being audited, so a change can never commit without its audit event.
 */
@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(event: AuditRecord, tx?: Writer): Promise<void> {
    const writer: Writer = tx ?? this.database.db;
    await writer.auditEvent.create({
      data: {
        tenantId: event.tenantId,
        action: event.action,
        outcome: event.outcome,
        actorId: event.actor.id,
        actorLabel: event.actor.label.slice(0, 320),
        targetType: event.target?.type ?? null,
        targetId: event.target?.id ?? null,
        targetLabel: event.target?.label?.slice(0, 320) ?? null,
        ipAddress: event.meta?.ipAddress ?? null,
        userAgent: event.meta?.userAgent ?? null,
        requestId: event.meta?.requestId ?? null,
        metadata: (event.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async list(tenantId: string, q: AuditQuery): Promise<CursorPage<AuditEvent>> {
    const rows = await this.database.db.auditEvent.findMany({
      where: {
        tenantId,
        ...(q.action ? { action: q.action } : {}),
        ...(q.outcome ? { outcome: q.outcome } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        // UUIDv7 ids are time-ordered, so the id is a stable descending cursor.
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        occurredAt: r.occurredAt.toISOString(),
        action: r.action as AuditAction,
        outcome: r.outcome,
        actor: { id: r.actorId, label: r.actorLabel },
        target:
          r.targetType && r.targetId
            ? { type: r.targetType, id: r.targetId, label: r.targetLabel }
            : null,
        ipAddress: r.ipAddress,
        requestId: r.requestId,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
      })),
      nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
