import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  BUILT_IN_ROLES,
  isMachinePermission,
  isPermission,
  MACHINE_PERMISSIONS,
} from "./permissions.js";

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

  it.each(["service_principals.manage", "tenant.sso.manage"])(
    "only the owner holds %s",
    (permission) => {
      const holders = Object.entries(BUILT_IN_ROLES)
        .filter(([, r]) => (r.permissions as readonly string[]).includes(permission))
        .map(([k]) => k);
      expect(holders).toEqual(["owner"]);
    },
  );

  it("machine permissions never include escalation paths", () => {
    for (const p of [
      "roles.assign",
      "identities.manage",
      "tenant.manage",
      "service_principals.manage",
      "connectors.manage",
    ]) {
      expect(isMachinePermission(p)).toBe(false);
    }
    for (const p of MACHINE_PERMISSIONS) expect(isPermission(p)).toBe(true);
  });

  it("rejects unknown and prototype permission strings", () => {
    expect(isPermission("tenant.delete_everything")).toBe(false);
    expect(isPermission("__proto__")).toBe(false);
    expect(isPermission("constructor")).toBe(false);
  });
});
