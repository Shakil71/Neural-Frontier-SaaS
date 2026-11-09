import { describe, expect, it } from "vitest";
import { collectPermissions } from "./authorization.service.js";

describe("collectPermissions", () => {
  it("unions role permissions", () => {
    const p = collectPermissions([["audit.read"], ["identities.read", "audit.read"]]);
    expect([...p].sort()).toEqual(["audit.read", "identities.read"]);
  });

  it("drops unknown keys and malformed data stored in the database", () => {
    const p = collectPermissions([
      ["audit.read", "root.everything", 7, null],
      "not-an-array",
      null,
      { x: 1 },
    ]);
    expect([...p]).toEqual(["audit.read"]);
  });

  it("returns nothing for no roles", () => {
    expect(collectPermissions([]).size).toBe(0);
  });
});
