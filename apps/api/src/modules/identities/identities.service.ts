import { Injectable } from "@nestjs/common";
import type { CursorPage, Identity, IdentityListQuery, UpdateIdentityStatus } from "@nf/contracts";
import type { Prisma } from "@nf/db";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../auth/session.service.js";
import { assertNotLastOwner } from "../roles/owner-invariant.js";

const include = {
  roleAssignments: { select: { role: { select: { id: true, key: true, name: true } } } },
} satisfies Prisma.IdentityInclude;

type Row = Prisma.IdentityGetPayload<{ include: typeof include }>;

function toDto(r: Row): Identity {
  return {
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    status: r.status,
    source: r.scimManaged ? "scim" : "oidc",
    lastSignInAt: r.lastSignInAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    roles: r.roleAssignments.map((a) => a.role),
    version: r.version,
  };
}

@Injectable()
export class IdentitiesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async list(tenantId: string, q: IdentityListQuery): Promise<CursorPage<Identity>> {
    const rows = await this.database.db.identity.findMany({
      where: {
        tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? { OR: [{ email: { contains: q.search } }, { displayName: { contains: q.search } }] }
          : {}),
        ...(q.cursor ? { id: { gt: q.cursor } } : {}),
      },
      include,
      orderBy: { id: "asc" },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map(toDto),
      nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(tenantId: string, id: string): Promise<Identity> {
    const row = await this.database.db.identity.findUnique({ where: { id, tenantId }, include });
    if (!row) throw Errors.notFound("Identity");
    return toDto(row);
  }

  /**
   * Suspend or reactivate. Optimistic concurrency via `version`; suspension revokes every
   * session immediately; you cannot suspend yourself or the last active owner.
   */
  async updateStatus(
    actor: Principal,
    id: string,
    input: UpdateIdentityStatus,
    meta: RequestMeta,
  ): Promise<Identity> {
    const tenantId = actor.tenantId;
    if (input.status === "suspended" && id === actor.identityId) {
      throw Errors.badRequest("You cannot suspend your own account");
    }
    await this.database.db.$transaction(async (tx) => {
      const current = await tx.identity.findUnique({ where: { id, tenantId } });
      if (!current) throw Errors.notFound("Identity");
      if (current.status === input.status) return;
      if (input.status === "suspended") await assertNotLastOwner(tx, tenantId, { identityId: id });

      const updated = await tx.identity.updateMany({
        where: { id, tenantId, version: input.version },
        data: { status: input.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw Errors.conflict("This identity was changed by someone else. Reload and try again.");
      }
      if (input.status === "suspended") await this.sessions.revokeAllFor(tenantId, id, tx);
      await this.audit.record(
        {
          tenantId,
          action: "identity.status_changed",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "identity", id, label: current.email },
          meta,
          metadata: { from: current.status, to: input.status, reason: input.reason },
        },
        tx,
      );
    });
    return this.get(tenantId, id);
  }
}
