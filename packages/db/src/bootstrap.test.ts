import { describe, expect, it } from "vitest";
import { validateBootstrapInput } from "./bootstrap.js";
import { _poolConfigFromUrl } from "./client.js";

const base = {
  tenantName: "Acme",
  tenantSlug: "acme",
  domain: "Acme.Example",
  ownerEmail: "Owner@acme.example",
  ownerName: "Ada Owner",
};

describe("validateBootstrapInput", () => {
  it("normalises domain and email", () => {
    const v = validateBootstrapInput(base);
    expect(v.domain).toBe("acme.example");
    expect(v.ownerEmail).toBe("owner@acme.example");
  });

  it("rejects an owner outside the tenant domain", () => {
    expect(() => validateBootstrapInput({ ...base, ownerEmail: "x@evil.example" })).toThrow(
      /tenant domain/,
    );
  });

  it("rejects a look-alike suffix domain", () => {
    expect(() => validateBootstrapInput({ ...base, ownerEmail: "x@notacme.example" })).toThrow(
      /tenant domain/,
    );
  });

  it("rejects bad slugs and domains", () => {
    expect(() => validateBootstrapInput({ ...base, tenantSlug: "Acme Corp" })).toThrow(
      /tenantSlug/,
    );
    expect(() => validateBootstrapInput({ ...base, domain: "localhost" })).toThrow(/DNS/);
  });
});

describe("DATABASE_URL parsing", () => {
  it("parses credentials, database and options", () => {
    const c = _poolConfigFromUrl(
      "mysql://nf%40app:p%3Ass@127.0.0.1:3307/neural_frontier?connectionLimit=5&allowPublicKeyRetrieval=true",
    );
    expect(c).toMatchObject({
      host: "127.0.0.1",
      port: 3307,
      user: "nf@app",
      password: "p:ss",
      database: "neural_frontier",
      connectionLimit: 5,
      allowPublicKeyRetrieval: true,
    });
  });

  it("rejects other schemes and missing database", () => {
    expect(() => _poolConfigFromUrl("postgres://u:p@h/db")).toThrow(/mysql/);
    expect(() => _poolConfigFromUrl("mysql://u:p@h/")).toThrow(/database name/);
  });
});
