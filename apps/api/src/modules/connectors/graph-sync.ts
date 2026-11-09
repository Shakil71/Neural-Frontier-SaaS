import type { Prisma, ScopedPrismaClient } from "@nf/db";
import type { GraphClient } from "./graph-client.js";

const USER_FIELDS = "id,displayName,userPrincipalName,mail,accountEnabled,jobTitle,department";
const GROUP_FIELDS =
  "id,displayName,description,mail,mailEnabled,securityEnabled,groupTypes,members";

export const USERS_DELTA_START = `/v1.0/users/delta?$select=${USER_FIELDS}`;
export const GROUPS_DELTA_START = `/v1.0/groups/delta?$select=${GROUP_FIELDS}`;

interface Removed {
  "@removed"?: { reason?: string };
}
export interface GraphUser extends Removed {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
  accountEnabled?: boolean | null;
  jobTitle?: string | null;
  department?: string | null;
}
interface GraphMemberRef extends Removed {
  "@odata.type"?: string;
  id: string;
}
export interface GraphGroup extends Removed {
  id: string;
  displayName?: string | null;
  description?: string | null;
  mail?: string | null;
  mailEnabled?: boolean | null;
  securityEnabled?: boolean | null;
  groupTypes?: string[] | null;
  "members@delta"?: GraphMemberRef[];
}

export interface SyncCounts {
  usersUpserted: number;
  usersRemoved: number;
  groupsUpserted: number;
  groupsRemoved: number;
  membershipsChanged: number;
}

export interface SyncResult {
  mode: "full" | "delta";
  counts: SyncCounts;
  usersDeltaLink: string | null;
  groupsDeltaLink: string | null;
}

const EXTERNAL_ID = /^[A-Za-z0-9-]{1,64}$/;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const clip = (v: string | null | undefined, n: number) =>
  v === null || v === undefined ? null : v.slice(0, n);

function memberType(odataType: string | undefined): "user" | "group" | "other" {
  if (odataType === "#microsoft.graph.user") return "user";
  if (odataType === "#microsoft.graph.group") return "group";
  return "other";
}

/** Only the properties Graph actually sent: delta pages may omit unchanged ones. */
function userChanges(u: GraphUser) {
  const data: Prisma.DirectoryUserUpdateInput = {};
  if (has(u, "displayName")) data.displayName = clip(u.displayName, 256) ?? "";
  if (has(u, "userPrincipalName")) data.userPrincipalName = clip(u.userPrincipalName, 320) ?? "";
  if (has(u, "mail")) data.mail = clip(u.mail, 320);
  if (has(u, "accountEnabled")) data.accountEnabled = u.accountEnabled !== false;
  if (has(u, "jobTitle")) data.jobTitle = clip(u.jobTitle, 128);
  if (has(u, "department")) data.department = clip(u.department, 128);
  return data;
}

function groupChanges(g: GraphGroup) {
  const data: Prisma.DirectoryGroupUpdateInput = {};
  if (has(g, "displayName")) data.displayName = clip(g.displayName, 256) ?? "";
  if (has(g, "description")) data.description = clip(g.description, 1024);
  if (has(g, "mail")) data.mail = clip(g.mail, 320);
  if (has(g, "mailEnabled")) data.mailEnabled = g.mailEnabled === true;
  if (has(g, "securityEnabled")) data.securityEnabled = g.securityEnabled === true;
  if (has(g, "groupTypes")) data.groupTypes = Array.isArray(g.groupTypes) ? g.groupTypes : [];
  return data;
}

const TX = { timeout: 60_000, maxWait: 10_000 };

/**
 * Mirrors users, groups and memberships from Microsoft Graph into the tenant's directory
 * tables using delta queries. Idempotent: re-running a page (after a crash or retry) yields
 * the same rows. Each page commits in its own transaction; the delta links are returned and
 * only stored by the caller once the whole run has succeeded, so an interrupted run resumes
 * from the last completed sync rather than skipping changes.
 *
 * Full mode (no stored delta link): everything is listed; afterwards rows not seen in this
 * run are marked deleted, because a full listing doesn't report removals.
 */
export async function syncGraphDirectory(opts: {
  db: ScopedPrismaClient;
  client: GraphClient;
  tenantId: string;
  connectorId: string;
  usersDeltaLink: string | null;
  groupsDeltaLink: string | null;
  signal?: AbortSignal;
}): Promise<SyncResult> {
  const { db, client, tenantId, connectorId, signal } = opts;
  const full = !opts.usersDeltaLink || !opts.groupsDeltaLink;
  const runStart = new Date();
  const counts: SyncCounts = {
    usersUpserted: 0,
    usersRemoved: 0,
    groupsUpserted: 0,
    groupsRemoved: 0,
    membershipsChanged: 0,
  };

  // ── Users ──
  let usersDeltaLink: string | null = null;
  for await (const page of client.pages<GraphUser>(
    full ? USERS_DELTA_START : opts.usersDeltaLink!,
    signal,
  )) {
    signal?.throwIfAborted();
    const now = new Date();
    await db.$transaction(async (tx) => {
      for (const u of page.items) {
        if (!u || typeof u.id !== "string" || !EXTERNAL_ID.test(u.id)) continue;
        if (u["@removed"]) {
          const res = await tx.directoryUser.updateMany({
            where: { tenantId, connectorId, externalId: u.id, deletedAt: null },
            data: { deletedAt: now, syncedAt: now },
          });
          counts.usersRemoved += res.count;
          continue;
        }
        const changes = userChanges(u);
        await tx.directoryUser.upsert({
          where: {
            tenantId_connectorId_externalId: { tenantId, connectorId, externalId: u.id },
            tenantId,
          },
          create: {
            tenantId,
            connectorId,
            externalId: u.id,
            displayName: clip(u.displayName, 256) ?? u.userPrincipalName ?? u.id,
            userPrincipalName: clip(u.userPrincipalName, 320) ?? u.id,
            mail: clip(u.mail, 320),
            accountEnabled: u.accountEnabled !== false,
            jobTitle: clip(u.jobTitle, 128),
            department: clip(u.department, 128),
            syncedAt: now,
          },
          update: { ...changes, deletedAt: null, syncedAt: now },
        });
        counts.usersUpserted++;
      }
    }, TX);
    if (page.deltaLink) usersDeltaLink = page.deltaLink;
  }

  // ── Groups and memberships ──
  let groupsDeltaLink: string | null = null;
  for await (const page of client.pages<GraphGroup>(
    full ? GROUPS_DELTA_START : opts.groupsDeltaLink!,
    signal,
  )) {
    signal?.throwIfAborted();
    const now = new Date();
    await db.$transaction(async (tx) => {
      for (const g of page.items) {
        if (!g || typeof g.id !== "string" || !EXTERNAL_ID.test(g.id)) continue;
        if (g["@removed"]) {
          const res = await tx.directoryGroup.updateMany({
            where: { tenantId, connectorId, externalId: g.id, deletedAt: null },
            data: { deletedAt: now, syncedAt: now },
          });
          counts.groupsRemoved += res.count;
          const m = await tx.directoryMembership.deleteMany({
            where: { tenantId, connectorId, groupExternalId: g.id },
          });
          counts.membershipsChanged += m.count;
          continue;
        }
        await tx.directoryGroup.upsert({
          where: {
            tenantId_connectorId_externalId: { tenantId, connectorId, externalId: g.id },
            tenantId,
          },
          create: {
            tenantId,
            connectorId,
            externalId: g.id,
            displayName: clip(g.displayName, 256) ?? g.id,
            description: clip(g.description, 1024),
            mail: clip(g.mail, 320),
            mailEnabled: g.mailEnabled === true,
            securityEnabled: g.securityEnabled === true,
            groupTypes: Array.isArray(g.groupTypes) ? g.groupTypes : [],
            syncedAt: now,
          },
          update: { ...groupChanges(g), deletedAt: null, syncedAt: now },
        });
        counts.groupsUpserted++;

        for (const m of g["members@delta"] ?? []) {
          if (!m || typeof m.id !== "string" || !EXTERNAL_ID.test(m.id)) continue;
          const key = {
            tenantId_connectorId_groupExternalId_memberExternalId: {
              tenantId,
              connectorId,
              groupExternalId: g.id,
              memberExternalId: m.id,
            },
            tenantId,
          };
          if (m["@removed"]) {
            const res = await tx.directoryMembership.deleteMany({
              where: { tenantId, connectorId, groupExternalId: g.id, memberExternalId: m.id },
            });
            counts.membershipsChanged += res.count;
          } else {
            await tx.directoryMembership.upsert({
              where: key,
              create: {
                tenantId,
                connectorId,
                groupExternalId: g.id,
                memberExternalId: m.id,
                memberType: memberType(m["@odata.type"]),
                syncedAt: now,
              },
              update: { syncedAt: now },
            });
            counts.membershipsChanged++;
          }
        }
      }
    }, TX);
    if (page.deltaLink) groupsDeltaLink = page.deltaLink;
  }

  if (full) {
    // A full listing doesn't report deletions: anything not seen in this run is gone.
    const users = await db.directoryUser.updateMany({
      where: { tenantId, connectorId, deletedAt: null, syncedAt: { lt: runStart } },
      data: { deletedAt: new Date() },
    });
    const groups = await db.directoryGroup.updateMany({
      where: { tenantId, connectorId, deletedAt: null, syncedAt: { lt: runStart } },
      data: { deletedAt: new Date() },
    });
    const memberships = await db.directoryMembership.deleteMany({
      where: { tenantId, connectorId, syncedAt: { lt: runStart } },
    });
    counts.usersRemoved += users.count;
    counts.groupsRemoved += groups.count;
    counts.membershipsChanged += memberships.count;
  }

  return { mode: full ? "full" : "delta", counts, usersDeltaLink, groupsDeltaLink };
}
