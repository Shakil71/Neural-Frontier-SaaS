/**
 * Tenant guard: refuses any query on a tenant-owned model that is not explicitly
 * scoped by `tenantId`. This turns "forgot the tenant filter" — the most common
 * multi-tenant data leak — into an immediate runtime error instead of a silent leak.
 *
 * The database adds a second layer: composite (tenantId, id) foreign keys make it
 * impossible to link rows from different tenants (see prisma/schema.prisma).
 */

/** Models whose every query must be scoped by tenantId. */
export const TENANT_SCOPED_MODELS = new Set([
  "TenantDomain",
  "Identity",
  "Role",
  "RoleAssignment",
  "Session",
  "AuditEvent",
  "IdempotencyKey",
  "Connector",
  "SyncRun",
  "DirectoryUser",
  "DirectoryGroup",
  "DirectoryMembership",
  "Job",
  "ServicePrincipal",
  "ServicePrincipalSecret",
  "TenantIdentityProvider",
  "ScimToken",
]);

const READ_OR_FILTERED_WRITE = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);

export class TenantScopeViolation extends Error {
  constructor(model: string, operation: string, reason: string) {
    super(`Tenant scope violation on ${model}.${operation}: ${reason}`);
    this.name = "TenantScopeViolation";
  }
}

function hasTenantKey(obj: unknown): boolean {
  return typeof obj === "object" && obj !== null && "tenantId" in obj;
}

/** Throws unless the query is scoped to a tenant. Pure function, unit-tested. */
export function assertTenantScoped(model: string | undefined, operation: string, args: unknown) {
  if (!model || !TENANT_SCOPED_MODELS.has(model)) return;
  const a = (args ?? {}) as Record<string, unknown>;

  if (READ_OR_FILTERED_WRITE.has(operation)) {
    const where = a.where as Record<string, unknown> | undefined;
    if (!hasTenantKey(where) || where?.tenantId === undefined) {
      throw new TenantScopeViolation(model, operation, "`where.tenantId` is required");
    }
    return;
  }

  if (CREATES.has(operation)) {
    const data = a.data;
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0 || !rows.every(hasTenantKey)) {
      throw new TenantScopeViolation(model, operation, "`data.tenantId` is required on every row");
    }
    return;
  }

  if (operation === "upsert") {
    const where = a.where as Record<string, unknown> | undefined;
    if (!hasTenantKey(where) || !hasTenantKey(a.create)) {
      throw new TenantScopeViolation(
        model,
        operation,
        "`where.tenantId` and `create.tenantId` are required",
      );
    }
    return;
  }

  // Raw or unknown operations on tenant models are refused outright.
  throw new TenantScopeViolation(
    model,
    operation,
    "operation is not allowed through the scoped client",
  );
}
