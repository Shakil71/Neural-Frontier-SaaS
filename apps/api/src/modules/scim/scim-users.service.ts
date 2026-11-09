import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@nf/db";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import type { RequestMeta } from "../../common/principal.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../auth/session.service.js";
import { assertNotLastOwner } from "../roles/owner-invariant.js";
import type { ScimCaller } from "./scim-tokens.js";

export const SCIM_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

/** A SCIM protocol error (RFC 7644 §3.12), rendered by ScimExceptionFilter. */
export class ScimError extends Error {
  constructor(
    readonly status: number,
    detail: string,
    readonly scimType?:
      "invalidFilter" | "invalidValue" | "invalidSyntax" | "uniqueness" | "mutability" | "noTarget",
  ) {
    super(detail);
  }
}

type IdentityRow = Prisma.IdentityGetPayload<object>;

export interface ScimUserInput {
  userName?: unknown;
  externalId?: unknown;
  displayName?: unknown;
  name?: unknown;
  active?: unknown;
}

/** SCIM booleans arrive as true/false or, from some clients (Entra ID), "True"/"False". */
function bool(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value))
    return value.toLowerCase() === "true";
  throw new ScimError(400, `${field} must be a boolean`, "invalidValue");
}

function str(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ScimError(
      400,
      `${field} must be a non-empty string of at most ${max} characters`,
      "invalidValue",
    );
  }
  return value.trim();
}

function nameToDisplay(name: unknown): string | null {
  if (typeof name !== "object" || name === null) return null;
  const n = name as Record<string, unknown>;
  if (typeof n.formatted === "string" && n.formatted.trim()) return n.formatted.trim();
  const parts = [n.givenName, n.familyName].filter(
    (p): p is string => typeof p === "string" && !!p.trim(),
  );
  return parts.length ? parts.join(" ").trim() : null;
}

const FILTER =
  /^\s*(userName|externalId|id|emails(?:\.value|\[type eq "work"\]\.value))\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i;

/**
 * SCIM 2.0 Users (RFC 7643/7644) mapped onto tenant identities.
 * - `userName` is the work email and must be on one of the tenant's verified domains.
 * - New users get the Member role (no administrative access), like SSO auto-provisioning.
 * - Deactivation (active=false, or DELETE) suspends the identity and ends its sessions at once.
 *   Identities are never hard-deleted: the audit trail references them.
 * - The last active Tenant Owner can't be deactivated this way.
 */
@Injectable()
export class ScimUsersService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  toScim(r: IdentityRow) {
    return {
      schemas: [SCIM_USER],
      id: r.id,
      ...(r.scimExternalId ? { externalId: r.scimExternalId } : {}),
      userName: r.email,
      displayName: r.displayName,
      name: { formatted: r.displayName },
      emails: [{ value: r.email, type: "work", primary: true }],
      active: r.status === "active",
      meta: {
        resourceType: "User",
        created: r.createdAt.toISOString(),
        lastModified: r.updatedAt.toISOString(),
        location: new URL(`/api/scim/v2/Users/${r.id}`, this.config.publicUrl).toString(),
        version: `W/"${r.version}"`,
      },
    };
  }

  private async email(tenantId: string, value: unknown): Promise<string> {
    const email = str(value, "userName", 320).toLowerCase();
    const domain = /^[^\s@]{1,64}@([^\s@]{1,253})$/.exec(email)?.[1];
    const ok =
      domain &&
      (await this.database.db.tenantDomain.findFirst({
        where: { tenantId, domain, verifiedAt: { not: null } },
      }));
    if (!ok) {
      throw new ScimError(
        400,
        "userName must be an email address on one of the organisation's verified domains",
        "invalidValue",
      );
    }
    return email;
  }

  private async load(tenantId: string, id: string): Promise<IdentityRow> {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.database.db.identity.findUnique({ where: { id, tenantId } })
      : null;
    if (!row) throw new ScimError(404, `User ${id} not found`);
    return row;
  }

  async get(caller: ScimCaller, id: string) {
    return this.toScim(await this.load(caller.tenantId, id));
  }

  async list(caller: ScimCaller, filter: string | undefined, startIndex: number, count: number) {
    const tenantId = caller.tenantId;
    let where: Prisma.IdentityWhereInput = { tenantId };
    if (filter) {
      const m = FILTER.exec(filter);
      if (!m) {
        throw new ScimError(
          400,
          'Supported filters: userName, externalId, id or emails.value with "eq"',
          "invalidFilter",
        );
      }
      const attr = m[1]!.toLowerCase();
      const value = m[2]!.replace(/\\(.)/g, "$1");
      where =
        attr === "externalid"
          ? { tenantId, scimExternalId: value }
          : attr === "id"
            ? { tenantId, id: value }
            : { tenantId, email: value.toLowerCase() };
    }
    const [total, rows] = await Promise.all([
      this.database.db.identity.count({
        where: where as Prisma.IdentityWhereInput & { tenantId: string },
      }),
      this.database.db.identity.findMany({
        where: where as Prisma.IdentityWhereInput & { tenantId: string },
        orderBy: { id: "asc" },
        skip: startIndex - 1,
        take: count,
      }),
    ]);
    return {
      schemas: [SCIM_LIST],
      totalResults: total,
      startIndex,
      itemsPerPage: rows.length,
      Resources: rows.map((r) => this.toScim(r)),
    };
  }

  async create(caller: ScimCaller, input: ScimUserInput, meta: RequestMeta) {
    const tenantId = caller.tenantId;
    const email = await this.email(tenantId, input.userName);
    const displayName =
      (typeof input.displayName === "string" && input.displayName.trim()) ||
      nameToDisplay(input.name) ||
      email;
    const externalId =
      input.externalId === undefined || input.externalId === null
        ? null
        : str(input.externalId, "externalId", 255);
    const active = input.active === undefined ? true : bool(input.active, "active");
    try {
      const id = await this.database.db.$transaction(async (tx) => {
        const member = await tx.role.findUniqueOrThrow({
          where: { tenantId_key: { tenantId, key: "member" }, tenantId },
        });
        const created = await tx.identity.create({
          data: {
            tenantId,
            email,
            displayName: displayName.slice(0, 200),
            status: active ? "active" : "suspended",
            scimExternalId: externalId,
            scimManaged: true,
          },
        });
        await tx.roleAssignment.create({
          data: {
            tenantId,
            identityId: created.id,
            roleId: member.id,
            reason: "Provisioned by SCIM",
          },
        });
        await this.audit.record(
          {
            tenantId,
            action: "identity.provisioned",
            outcome: "success",
            actor: { id: caller.tokenId, label: caller.label },
            target: { type: "identity", id: created.id, label: email },
            meta,
            metadata: { via: "scim", role: "member", active, externalId },
          },
          tx,
        );
        return created.id;
      });
      return this.get(caller, id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ScimError(
          409,
          "A user with this userName or externalId already exists",
          "uniqueness",
        );
      }
      throw err;
    }
  }

  /**
   * Applies a set of attribute changes (from PUT or PATCH) in one transaction, with the
   * last-owner and session-revocation rules for deactivation.
   */
  private async apply(
    caller: ScimCaller,
    id: string,
    changes: { email?: string; displayName?: string; externalId?: string | null; active?: boolean },
    meta: RequestMeta,
  ) {
    const tenantId = caller.tenantId;
    const current = await this.load(tenantId, id);
    try {
      await this.database.db.$transaction(async (tx) => {
        const status =
          changes.active === undefined ? undefined : changes.active ? "active" : "suspended";
        if (status === "suspended" && current.status === "active") {
          try {
            await assertNotLastOwner(tx, tenantId, { identityId: id });
          } catch {
            throw new ScimError(
              409,
              "This is the last active Tenant Owner; assign another owner before deactivating",
              "mutability",
            );
          }
        }
        await tx.identity.update({
          where: { id, tenantId },
          data: {
            ...(changes.email !== undefined ? { email: changes.email } : {}),
            ...(changes.displayName !== undefined
              ? { displayName: changes.displayName.slice(0, 200) }
              : {}),
            ...(changes.externalId !== undefined ? { scimExternalId: changes.externalId } : {}),
            ...(status ? { status } : {}),
            scimManaged: true,
            version: { increment: 1 },
          },
        });
        if (status && status !== current.status) {
          if (status === "suspended") await this.sessions.revokeAllFor(tenantId, id, tx);
          await this.audit.record(
            {
              tenantId,
              action: "identity.status_changed",
              outcome: "success",
              actor: { id: caller.tokenId, label: caller.label },
              target: { type: "identity", id, label: changes.email ?? current.email },
              meta,
              metadata: {
                from: current.status,
                to: status,
                reason:
                  status === "suspended"
                    ? "Deactivated by the SCIM provisioning client"
                    : "Reactivated by the SCIM provisioning client",
                via: "scim",
              },
            },
            tx,
          );
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ScimError(
          409,
          "Another user already has this userName or externalId",
          "uniqueness",
        );
      }
      throw err;
    }
    return this.get(caller, id);
  }

  async replace(caller: ScimCaller, id: string, input: ScimUserInput, meta: RequestMeta) {
    const displayName =
      (typeof input.displayName === "string" && input.displayName.trim()) ||
      nameToDisplay(input.name);
    return this.apply(
      caller,
      id,
      {
        email: await this.email(caller.tenantId, input.userName),
        ...(displayName ? { displayName } : {}),
        externalId:
          input.externalId === undefined || input.externalId === null
            ? null
            : str(input.externalId, "externalId", 255),
        active: input.active === undefined ? true : bool(input.active, "active"),
      },
      meta,
    );
  }

  /** RFC 7644 §3.5.2 PATCH, for the attributes this resource supports. */
  async patch(caller: ScimCaller, id: string, body: unknown, meta: RequestMeta) {
    const ops = (body as { Operations?: unknown } | null)?.Operations;
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > 50) {
      throw new ScimError(400, "Operations must be a non-empty array", "invalidSyntax");
    }
    const changes: {
      email?: string;
      displayName?: string;
      externalId?: string | null;
      active?: boolean;
    } = {};
    const set = async (path: string, value: unknown, remove: boolean) => {
      const p = path.toLowerCase();
      if (p === "active") changes.active = remove ? false : bool(value, "active");
      else if (p === "displayname" || p === "name.formatted") {
        if (!remove) changes.displayName = str(value, "displayName", 200);
      } else if (p === "username") {
        if (remove) throw new ScimError(400, "userName can't be removed", "mutability");
        changes.email = await this.email(caller.tenantId, value);
      } else if (p === "externalid") {
        changes.externalId = remove ? null : str(value, "externalId", 255);
      } else if (p === "name.givenname" || p === "name.familyname" || p === "name") {
        // Only a display name is kept; name parts are recomposed when both arrive in one request.
        const display = nameToDisplay(p === "name" ? value : { [p.slice(5)]: value });
        if (display && !remove && !changes.displayName) changes.displayName = display;
      }
      // Other attributes (title, phoneNumbers, addresses…) aren't stored and are ignored, which
      // RFC 7644 permits for attributes outside the resource's supported schema.
    };
    for (const raw of ops) {
      const op = raw as { op?: unknown; path?: unknown; value?: unknown };
      const kind = typeof op.op === "string" ? op.op.toLowerCase() : "";
      if (!["add", "replace", "remove"].includes(kind)) {
        throw new ScimError(400, `Unsupported op ${String(op.op)}`, "invalidSyntax");
      }
      if (typeof op.path === "string" && op.path) {
        await set(op.path, op.value, kind === "remove");
      } else if (kind !== "remove" && typeof op.value === "object" && op.value !== null) {
        for (const [k, v] of Object.entries(op.value as Record<string, unknown>))
          await set(k, v, false);
      } else {
        throw new ScimError(400, "remove needs a path", "noTarget");
      }
    }
    return this.apply(caller, id, changes, meta);
  }

  /** DELETE deactivates (suspends) rather than erasing: the audit trail references identities. */
  async remove(caller: ScimCaller, id: string, meta: RequestMeta) {
    await this.apply(caller, id, { active: false }, meta);
  }
}
