import { Inject, Injectable } from "@nestjs/common";
import type {
  ConnectionTest,
  Connector,
  CreateConnector,
  CursorPage,
  SyncRun,
  UpdateConnector,
} from "@nf/contracts";
import { Prisma, type ScopedTransaction } from "@nf/db";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { hintOf, seal, unseal } from "../../common/sealed.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ActiveJobExists, JobQueue } from "../jobs/job-queue.js";
import { GraphClient, GraphError } from "./graph-client.js";

export const SYNC_JOB = "connector.sync";
export const syncActiveKey = (connectorId: string) => `connector-sync:${connectorId}`;
/** Bound by MySQL's unique index on (tenantId, name) and an explicit per-tenant cap. */
const MAX_CONNECTORS_PER_TENANT = 20;

type ConnectorRow = Prisma.ConnectorGetPayload<object>;

export interface GraphConfig {
  directoryId: string;
  clientId: string;
}

export function graphConfig(row: ConnectorRow): GraphConfig {
  const c = (row.config ?? {}) as Partial<GraphConfig>;
  return { directoryId: String(c.directoryId ?? ""), clientId: String(c.clientId ?? "") };
}

/** AAD for the sealed credential: binds it to this tenant and connector. */
export const secretContext = (tenantId: string, connectorId: string) =>
  `connector-secret:${tenantId}:${connectorId}`;

export function toSyncRunDto(r: Prisma.SyncRunGetPayload<object>): SyncRun {
  return {
    id: r.id,
    connectorId: r.connectorId,
    status: r.status,
    trigger: r.trigger === "schedule" ? "schedule" : "manual",
    mode: r.mode === "full" || r.mode === "delta" ? r.mode : null,
    attempts: r.attempts,
    usersUpserted: r.usersUpserted,
    usersRemoved: r.usersRemoved,
    groupsUpserted: r.groupsUpserted,
    groupsRemoved: r.groupsRemoved,
    membershipsChanged: r.membershipsChanged,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ConnectorsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobQueue,
  ) {}

  private requireDataKey(): Buffer {
    if (!this.config.dataKey) {
      throw Errors.unavailable(
        "Connectors aren't available: NF_DATA_KEY is not configured on this deployment",
      );
    }
    return this.config.dataKey;
  }

  private async counts(tenantId: string, ids: string[]) {
    if (ids.length === 0) return new Map<string, { users: number; groups: number }>();
    const [users, groups] = await Promise.all([
      this.database.db.directoryUser.groupBy({
        by: ["connectorId"],
        where: { tenantId, connectorId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      this.database.db.directoryGroup.groupBy({
        by: ["connectorId"],
        where: { tenantId, connectorId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const map = new Map(ids.map((id) => [id, { users: 0, groups: 0 }]));
    for (const u of users) map.get(u.connectorId)!.users = u._count._all;
    for (const g of groups) map.get(g.connectorId)!.groups = g._count._all;
    return map;
  }

  private toDto(r: ConnectorRow, counts: { users: number; groups: number }): Connector {
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      status: r.status,
      config: graphConfig(r),
      secretHint: r.secretHint,
      syncIntervalMinutes: r.syncIntervalMinutes,
      lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: r.lastSyncStatus,
      counts,
      createdAt: r.createdAt.toISOString(),
      version: r.version,
    };
  }

  async list(tenantId: string): Promise<Connector[]> {
    const rows = await this.database.db.connector.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const counts = await this.counts(
      tenantId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => this.toDto(r, counts.get(r.id)!));
  }

  async get(tenantId: string, id: string): Promise<Connector> {
    const row = await this.database.db.connector.findUnique({ where: { id, tenantId } });
    if (!row) throw Errors.notFound("Connector");
    const counts = await this.counts(tenantId, [id]);
    return this.toDto(row, counts.get(id)!);
  }

  async create(actor: Principal, input: CreateConnector, meta: RequestMeta): Promise<Connector> {
    const key = this.requireDataKey();
    const tenantId = actor.tenantId;
    const id = await this.database.db
      .$transaction(async (tx) => {
        const existing = await tx.connector.count({ where: { tenantId } });
        if (existing >= MAX_CONNECTORS_PER_TENANT) {
          throw Errors.conflict(
            `A tenant can have at most ${MAX_CONNECTORS_PER_TENANT} connectors`,
          );
        }
        const row = await tx.connector.create({
          data: {
            tenantId,
            kind: input.kind,
            name: input.name,
            config: { directoryId: input.directoryId, clientId: input.clientId },
            syncIntervalMinutes: input.syncIntervalMinutes,
            createdById: actor.identityId,
          },
        });
        await tx.connector.update({
          where: { id: row.id, tenantId },
          data: {
            secretCiphertext: seal(key, input.clientSecret, secretContext(tenantId, row.id)),
            secretHint: hintOf(input.clientSecret),
          },
        });
        await this.audit.record(
          {
            tenantId,
            action: "connector.created",
            outcome: "success",
            actor: { id: actor.identityId, label: actor.email },
            target: { type: "connector", id: row.id, label: row.name },
            meta,
            metadata: {
              kind: input.kind,
              directoryId: input.directoryId,
              clientId: input.clientId,
              syncIntervalMinutes: input.syncIntervalMinutes,
            },
          },
          tx,
        );
        return row.id;
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw Errors.conflict(`A connector named "${input.name}" already exists`);
        }
        throw err;
      });
    return this.get(tenantId, id);
  }

  async update(
    actor: Principal,
    id: string,
    input: UpdateConnector,
    meta: RequestMeta,
  ): Promise<Connector> {
    const tenantId = actor.tenantId;
    const key = input.clientSecret ? this.requireDataKey() : null;
    await this.database.db
      .$transaction(async (tx) => {
        const current = await tx.connector.findUnique({ where: { id, tenantId } });
        if (!current) throw Errors.notFound("Connector");
        const res = await tx.connector.updateMany({
          where: { id, tenantId, version: input.version },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.syncIntervalMinutes !== undefined
              ? { syncIntervalMinutes: input.syncIntervalMinutes }
              : {}),
            ...(key && input.clientSecret
              ? {
                  secretCiphertext: seal(key, input.clientSecret, secretContext(tenantId, id)),
                  secretHint: hintOf(input.clientSecret),
                }
              : {}),
            version: { increment: 1 },
          },
        });
        if (res.count === 0) {
          throw Errors.conflict(
            "This connector was changed by someone else. Reload and try again.",
          );
        }
        await this.audit.record(
          {
            tenantId,
            action: "connector.updated",
            outcome: "success",
            actor: { id: actor.identityId, label: actor.email },
            target: { type: "connector", id, label: input.name ?? current.name },
            meta,
            metadata: {
              ...(input.name !== undefined && input.name !== current.name
                ? { name: { from: current.name, to: input.name } }
                : {}),
              ...(input.status !== undefined && input.status !== current.status
                ? { status: { from: current.status, to: input.status } }
                : {}),
              ...(input.syncIntervalMinutes !== undefined &&
              input.syncIntervalMinutes !== current.syncIntervalMinutes
                ? {
                    syncIntervalMinutes: {
                      from: current.syncIntervalMinutes,
                      to: input.syncIntervalMinutes,
                    },
                  }
                : {}),
              ...(input.clientSecret ? { secretRotated: true } : {}),
            },
          },
          tx,
        );
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw Errors.conflict(`A connector named "${input.name}" already exists`);
        }
        throw err;
      });
    return this.get(tenantId, id);
  }

  /** Deletes the connector and every user, group and membership synced through it. */
  async remove(actor: Principal, id: string, reason: string, meta: RequestMeta): Promise<void> {
    const tenantId = actor.tenantId;
    await this.database.db.$transaction(
      async (tx) => {
        const current = await tx.connector.findUnique({ where: { id, tenantId } });
        if (!current) throw Errors.notFound("Connector");
        const counts = await this.counts(tenantId, [id]);
        await tx.job.deleteMany({
          where: { tenantId, activeKey: syncActiveKey(id), status: "queued" },
        });
        // Explicit, in dependency order, so large directories don't rely on one huge cascade.
        await tx.directoryMembership.deleteMany({ where: { tenantId, connectorId: id } });
        await tx.directoryUser.deleteMany({ where: { tenantId, connectorId: id } });
        await tx.directoryGroup.deleteMany({ where: { tenantId, connectorId: id } });
        await tx.syncRun.deleteMany({ where: { tenantId, connectorId: id } });
        await tx.connector.delete({ where: { id, tenantId } });
        await this.audit.record(
          {
            tenantId,
            action: "connector.deleted",
            outcome: "success",
            actor: { id: actor.identityId, label: actor.email },
            target: { type: "connector", id, label: current.name },
            meta,
            metadata: { reason, removed: counts.get(id) },
          },
          tx,
        );
      },
      { timeout: 120_000 },
    );
  }

  /** Queues a sync. 409 if one is already queued or running for this connector. */
  async requestSync(
    tenantId: string,
    id: string,
    trigger: "manual" | "schedule",
    actor: { id: string | null; label: string },
    meta?: RequestMeta,
  ): Promise<SyncRun> {
    try {
      const run = await this.database.db.$transaction(async (tx) => {
        const connector = await tx.connector.findUnique({ where: { id, tenantId } });
        if (!connector) throw Errors.notFound("Connector");
        if (connector.status !== "active") {
          throw Errors.conflict("This connector is disabled. Enable it to sync.");
        }
        return this.enqueueSync(tx, connector, trigger, actor, meta);
      });
      return toSyncRunDto(run);
    } catch (err) {
      if (err instanceof ActiveJobExists) {
        throw Errors.conflict("A sync for this connector is already queued or running");
      }
      throw err;
    }
  }

  async enqueueSync(
    tx: ScopedTransaction,
    connector: ConnectorRow,
    trigger: "manual" | "schedule",
    actor: { id: string | null; label: string },
    meta?: RequestMeta,
  ) {
    const tenantId = connector.tenantId;
    const run = await tx.syncRun.create({
      data: { tenantId, connectorId: connector.id, trigger, requestedById: actor.id },
    });
    await this.jobs.enqueue(
      {
        tenantId,
        type: SYNC_JOB,
        payload: { connectorId: connector.id, syncRunId: run.id },
        activeKey: syncActiveKey(connector.id),
        maxAttempts: 4,
      },
      tx,
    );
    await this.audit.record(
      {
        tenantId,
        action: "connector.sync_requested",
        outcome: "success",
        actor,
        target: { type: "connector", id: connector.id, label: connector.name },
        ...(meta ? { meta } : {}),
        metadata: { syncRunId: run.id, trigger },
      },
      tx,
    );
    return run;
  }

  async runs(
    tenantId: string,
    connectorId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<SyncRun>> {
    const rows = await this.database.db.syncRun.findMany({
      where: { tenantId, connectorId, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: "desc" },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(toSyncRunDto),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Builds a Graph client from the stored, sealed credential. */
  clientFor(row: ConnectorRow): GraphClient {
    const key = this.requireDataKey();
    if (!row.secretCiphertext) throw Errors.conflict("This connector has no stored credential");
    const cfg = graphConfig(row);
    return new GraphClient(this.config.graph, {
      directoryId: cfg.directoryId,
      clientId: cfg.clientId,
      clientSecret: unseal(
        key,
        new Uint8Array(row.secretCiphertext),
        secretContext(row.tenantId, row.id),
      ),
    });
  }

  /** Checks credentials and permissions with two tiny reads. Never changes data. */
  async test(tenantId: string, id: string): Promise<ConnectionTest> {
    const row = await this.database.db.connector.findUnique({ where: { id, tenantId } });
    if (!row) throw Errors.notFound("Connector");
    const checkedAt = new Date().toISOString();
    try {
      const client = this.clientFor(row);
      await client.get("/v1.0/users?$top=1&$select=id");
      await client.get("/v1.0/groups?$top=1&$select=id");
      return {
        ok: true,
        message: "Connected. The application can read users and groups.",
        checkedAt,
      };
    } catch (err) {
      if (err instanceof GraphError) return { ok: false, message: err.message, checkedAt };
      throw err;
    }
  }
}
