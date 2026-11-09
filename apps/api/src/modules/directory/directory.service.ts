import { Injectable } from "@nestjs/common";
import type {
  CursorPage,
  DirectoryGroup,
  DirectoryGroupMember,
  DirectoryQuery,
  DirectoryUser,
} from "@nf/contracts";
import { Errors } from "../../common/errors.js";
import { DatabaseService } from "../../infra/database.service.js";

function page<T extends { id: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}

/** Read-only views of users and groups mirrored from external directories. */
@Injectable()
export class DirectoryService {
  constructor(private readonly database: DatabaseService) {}

  async users(tenantId: string, q: DirectoryQuery): Promise<CursorPage<DirectoryUser>> {
    const rows = await this.database.db.directoryUser.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q.connectorId ? { connectorId: q.connectorId } : {}),
        ...(q.search
          ? {
              OR: [
                { displayName: { contains: q.search } },
                { userPrincipalName: { contains: q.search } },
                { mail: { contains: q.search } },
                { department: { contains: q.search } },
              ],
            }
          : {}),
        ...(q.cursor ? { id: { gt: q.cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: q.limit + 1,
    });
    const p = page(rows, q.limit);
    return {
      nextCursor: p.nextCursor,
      items: p.items.map((u) => ({
        id: u.id,
        connectorId: u.connectorId,
        externalId: u.externalId,
        userPrincipalName: u.userPrincipalName,
        mail: u.mail,
        displayName: u.displayName,
        jobTitle: u.jobTitle,
        department: u.department,
        accountEnabled: u.accountEnabled,
        syncedAt: u.syncedAt.toISOString(),
      })),
    };
  }

  async groups(tenantId: string, q: DirectoryQuery): Promise<CursorPage<DirectoryGroup>> {
    const rows = await this.database.db.directoryGroup.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(q.connectorId ? { connectorId: q.connectorId } : {}),
        ...(q.search
          ? {
              OR: [
                { displayName: { contains: q.search } },
                { mail: { contains: q.search } },
                { description: { contains: q.search } },
              ],
            }
          : {}),
        ...(q.cursor ? { id: { gt: q.cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: q.limit + 1,
    });
    const p = page(rows, q.limit);
    const counts = p.items.length
      ? await this.database.db.directoryMembership.groupBy({
          by: ["connectorId", "groupExternalId"],
          where: {
            tenantId,
            OR: p.items.map((g) => ({ connectorId: g.connectorId, groupExternalId: g.externalId })),
          },
          _count: { _all: true },
        })
      : [];
    const countOf = new Map(
      counts.map((c) => [`${c.connectorId}:${c.groupExternalId}`, c._count._all]),
    );
    return {
      nextCursor: p.nextCursor,
      items: p.items.map((g) => ({
        id: g.id,
        connectorId: g.connectorId,
        externalId: g.externalId,
        displayName: g.displayName,
        description: g.description,
        mail: g.mail,
        securityEnabled: g.securityEnabled,
        mailEnabled: g.mailEnabled,
        groupTypes: Array.isArray(g.groupTypes)
          ? g.groupTypes.filter((t): t is string => typeof t === "string")
          : [],
        memberCount: countOf.get(`${g.connectorId}:${g.externalId}`) ?? 0,
        syncedAt: g.syncedAt.toISOString(),
      })),
    };
  }

  async members(
    tenantId: string,
    groupId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<DirectoryGroupMember & { id: string }>> {
    const db = this.database.db;
    const group = await db.directoryGroup.findUnique({ where: { id: groupId, tenantId } });
    if (!group || group.deletedAt) throw Errors.notFound("Group");
    const rows = await db.directoryMembership.findMany({
      where: {
        tenantId,
        connectorId: group.connectorId,
        groupExternalId: group.externalId,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    const p = page(rows, limit);
    const ids = p.items.map((m) => m.memberExternalId);
    const [users, groups] = await Promise.all([
      db.directoryUser.findMany({
        where: {
          tenantId,
          connectorId: group.connectorId,
          externalId: { in: ids },
          deletedAt: null,
        },
      }),
      db.directoryGroup.findMany({
        where: {
          tenantId,
          connectorId: group.connectorId,
          externalId: { in: ids },
          deletedAt: null,
        },
      }),
    ]);
    const userBy = new Map(users.map((u) => [u.externalId, u]));
    const groupBy = new Map(groups.map((g) => [g.externalId, g]));
    return {
      nextCursor: p.nextCursor,
      items: p.items.map((m) => {
        const u = userBy.get(m.memberExternalId);
        const g = groupBy.get(m.memberExternalId);
        const type = m.memberType === "user" || m.memberType === "group" ? m.memberType : "other";
        return {
          id: m.id,
          externalId: m.memberExternalId,
          memberType: type,
          displayName: u?.displayName ?? g?.displayName ?? null,
          detail: u ? (u.mail ?? u.userPrincipalName) : (g?.mail ?? null),
        };
      }),
    };
  }
}
