import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { isPermission, type Role, type RoleAssignmentInput } from "@nf/contracts";
import { Prisma } from "@nf/db";
import { Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { assertNotLastOwner } from "./owner-invariant.js";

const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

export interface AssignmentResult {
  id: string;
  identityId: string;
  roleId: string;
  createdAt: string;
}

@Injectable()
export class RolesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<Role[]> {
    const roles = await this.database.db.role.findMany({
      where: { tenantId },
      include: { _count: { select: { assignments: true } } },
      orderBy: [{ builtIn: "desc" }, { name: "asc" }],
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      builtIn: r.builtIn,
      permissions: (Array.isArray(r.permissions) ? r.permissions : []).filter(
        (p): p is string => typeof p === "string" && isPermission(p),
      ),
      memberCount: r._count.assignments,
    }));
  }

  /**
   * Grants a role. With an Idempotency-Key, a retried request returns the original result
   * instead of failing or double-granting; reusing a key with a different body is a conflict.
   */
  async assign(
    actor: Principal,
    input: RoleAssignmentInput,
    meta: RequestMeta,
    idempotencyKey: string | null,
  ): Promise<AssignmentResult> {
    const tenantId = actor.tenantId;
    const requestHash = new Uint8Array(
      createHash("sha256")
        .update(JSON.stringify(["role.assign", input]))
        .digest(),
    );

    if (idempotencyKey) {
      const prior = await this.database.db.idempotencyKey.findUnique({
        where: { tenantId_key: { tenantId, key: idempotencyKey }, tenantId },
      });
      if (prior && prior.expiresAt > new Date()) {
        if (!Buffer.from(prior.requestHash).equals(requestHash)) {
          throw Errors.conflict("Idempotency-Key was already used for a different request");
        }
        return prior.responseBody as unknown as AssignmentResult;
      }
    }

    return this.database.db.$transaction(async (tx) => {
      const identity = await tx.identity.findUnique({ where: { id: input.identityId, tenantId } });
      if (!identity) throw Errors.notFound("Identity");
      const role = await tx.role.findUnique({ where: { id: input.roleId, tenantId } });
      if (!role) throw Errors.notFound("Role");

      let created;
      try {
        created = await tx.roleAssignment.create({
          data: {
            tenantId,
            identityId: identity.id,
            roleId: role.id,
            grantedById: actor.identityId,
            reason: input.reason,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw Errors.conflict(`${identity.displayName} already has the ${role.name} role`);
        }
        throw err;
      }

      await this.audit.record(
        {
          tenantId,
          action: "role.assigned",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "identity", id: identity.id, label: identity.email },
          meta,
          metadata: { role: role.key, roleId: role.id, reason: input.reason },
        },
        tx,
      );

      const result: AssignmentResult = {
        id: created.id,
        identityId: created.identityId,
        roleId: created.roleId,
        createdAt: created.createdAt.toISOString(),
      };
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            tenantId,
            key: idempotencyKey,
            identityId: actor.identityId,
            requestHash,
            responseStatus: 201,
            responseBody: result as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
      }
      return result;
    });
  }

  async revoke(
    actor: Principal,
    assignmentId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<void> {
    const tenantId = actor.tenantId;
    await this.database.db.$transaction(async (tx) => {
      const assignment = await tx.roleAssignment.findUnique({
        where: { id: assignmentId, tenantId },
        include: { role: true, identity: true },
      });
      if (!assignment) throw Errors.notFound("Role assignment");
      await assertNotLastOwner(tx, tenantId, {
        identityId: assignment.identityId,
        roleId: assignment.roleId,
      });
      await tx.roleAssignment.delete({ where: { id: assignment.id, tenantId } });
      await this.audit.record(
        {
          tenantId,
          action: "role.revoked",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          target: { type: "identity", id: assignment.identityId, label: assignment.identity.email },
          meta,
          metadata: { role: assignment.role.key, roleId: assignment.roleId, reason },
        },
        tx,
      );
    });
  }

  async assignmentsFor(tenantId: string, identityId: string) {
    return this.database.db.roleAssignment.findMany({
      where: { tenantId, identityId },
      select: { id: true, roleId: true, createdAt: true, reason: true },
    });
  }
}
