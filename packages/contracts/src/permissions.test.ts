import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, BUILT_IN_ROLES, isPermission } from "./permissions.js";

describe("permission catalog", () => {
  it("built-in roles only reference catalogued permissions", () => {
    for (const role of Object.values(BUILT_IN_ROLES)) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
  });

  it("only the owner can assign roles (separation of duties)", () => {
    const holders = Object.entries(BUILT_IN_ROLES)
      .filter(([, r]) => (r.permissions as readonly string[]).includes("roles.assign"))
      .map(([k]) => k);
    expect(holders).toEqual(["owner"]);
  });

  it("owner holds every permission", () => {
    expect([...BUILT_IN_ROLES.owner.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("rejects unknown and prototype permission strings", () => {
    expect(isPermission("tenant.delete_everything")).toBe(false);
    expect(isPermission("__proto__")).toBe(false);
    expect(isPermission("constructor")).toBe(false);
  });
});
