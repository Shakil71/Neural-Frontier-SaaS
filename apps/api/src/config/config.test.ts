import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  DATABASE_URL: "mysql://u:p@127.0.0.1:3306/nf",
  NF_PUBLIC_URL: "http://localhost:3400",
  NF_SESSION_SECRET: "a".repeat(32),
};
const prod = {
  ...base,
  NODE_ENV: "production",
  NF_PUBLIC_URL: "https://nf.example.com",
  REDIS_URL: "redis://nf:pw@127.0.0.1:6379/0",
};

describe("loadConfig", () => {
  it("applies secure defaults", () => {
    const c = loadConfig(base);
    expect(c.port).toBe(3401);
    expect(c.host).toBe("127.0.0.1");
    expect(c.cookie).toEqual({
      secure: true,
      sessionName: "__Host-nf_session",
      loginStateName: "__Host-nf_login",
    });
    expect(c.session.idleMs).toBe(30 * 60_000);
    expect(c.oidc).toBeNull();
    expect(c.apiDocs).toBe(false);
  });

  it("accepts a valid production configuration", () => {
    expect(loadConfig(prod).env).toBe("production");
  });

  it("refuses a short session secret", () => {
    expect(() => loadConfig({ ...base, NF_SESSION_SECRET: "short" })).toThrow(/NF_SESSION_SECRET/);
  });

  it.each([
    [{ NF_COOKIE_SECURE: "false" }, /NF_COOKIE_SECURE/],
    [{ NF_OIDC_ALLOW_INSECURE_HTTP: "true" }, /NF_OIDC_ALLOW_INSECURE_HTTP/],
    [{ REDIS_URL: undefined }, /REDIS_URL/],
    [{ NF_PUBLIC_URL: "http://nf.example.com" }, /NF_PUBLIC_URL/],
  ])("refuses insecure production setting %o", (override, message) => {
    expect(() => loadConfig({ ...prod, ...override })).toThrow(message);
  });

  it("treats empty values (KEY=) as unset, as in the production env template", () => {
    const c = loadConfig({
      ...base,
      NF_OIDC_ISSUER: "",
      NF_OIDC_CLIENT_ID: "",
      NF_OIDC_CLIENT_SECRET: " ",
    });
    expect(c.oidc).toBeNull();
  });

  it("requires OIDC settings as a complete set", () => {
    expect(() => loadConfig({ ...base, NF_OIDC_ISSUER: "https://idp.example.com" })).toThrow(
      /set together/,
    );
    const c = loadConfig({
      ...base,
      NF_OIDC_ISSUER: "https://idp.example.com",
      NF_OIDC_CLIENT_ID: "nf",
      NF_OIDC_CLIENT_SECRET: "secret",
    });
    expect(c.oidc?.issuer.href).toBe("https://idp.example.com/");
    expect(c.oidc?.requireEmailVerified).toBe(true);
  });
});
