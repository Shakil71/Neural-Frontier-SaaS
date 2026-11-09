import { describe, expect, it } from "vitest";
import { assertTenantScoped, TenantScopeViolation } from "./tenant-guard.js";

const T = "0192f1a0-0000-7000-8000-000000000001";

describe("assertTenantScoped", () => {
  it("allows tenant-scoped reads and writes", () => {
    expect(() =>
      assertTenantScoped("Identity", "findMany", { where: { tenantId: T } }),
    ).not.toThrow();
    expect(() =>
      assertTenantScoped("Identity", "update", { where: { id: "x", tenantId: T }, data: {} }),
    ).not.toThrow();
    expect(() => assertTenantScoped("Role", "create", { data: { tenantId: T } })).not.toThrow();
    expect(() =>
      assertTenantScoped("Role", "createMany", { data: [{ tenantId: T }, { tenantId: T }] }),
    ).not.toThrow();
  });

  it("refuses unscoped reads", () => {
    expect(() => assertTenantScoped("Identity", "findMany", {})).toThrow(TenantScopeViolation);
    expect(() => assertTenantScoped("Identity", "findUnique", { where: { id: "x" } })).toThrow(
      TenantScopeViolation,
    );
    expect(() => assertTenantScoped("AuditEvent", "count", undefined)).toThrow(
      TenantScopeViolation,
    );
  });

  it("refuses an undefined tenantId (e.g. a missing variable)", () => {
    expect(() =>
      assertTenantScoped("Identity", "findMany", { where: { tenantId: undefined } }),
    ).toThrow(TenantScopeViolation);
  });

  it("refuses unscoped bulk writes", () => {
    expect(() =>
      assertTenantScoped("Session", "updateMany", { data: { revokedAt: new Date() } }),
    ).toThrow(TenantScopeViolation);
    expect(() => assertTenantScoped("Session", "deleteMany", { where: {} })).toThrow(
      TenantScopeViolation,
    );
  });

  it("refuses creates where any row lacks tenantId", () => {
    expect(() =>
      assertTenantScoped("Role", "createMany", { data: [{ tenantId: T }, { name: "x" }] }),
    ).toThrow(TenantScopeViolation);
    expect(() => assertTenantScoped("Role", "createMany", { data: [] })).toThrow(
      TenantScopeViolation,
    );
  });

  it("refuses unknown operations on tenant models", () => {
    expect(() => assertTenantScoped("Identity", "someFutureOp", {})).toThrow(TenantScopeViolation);
  });

  it("ignores models that are not tenant-owned", () => {
    expect(() => assertTenantScoped("Tenant", "findMany", {})).not.toThrow();
    expect(() => assertTenantScoped(undefined, "$queryRaw", {})).not.toThrow();
  });
});
