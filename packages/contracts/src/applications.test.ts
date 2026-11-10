import { describe, expect, it } from "vitest";
import { RedirectUriSchema } from "./applications.js";

describe("RedirectUriSchema", () => {
  it.each([
    "https://app.example/cb",
    "https://app.example:8443/a?b=1",
    "http://localhost:3496/callback",
    "http://127.0.0.1:8765/cb",
    "http://[::1]:8080/cb",
    "com.example.app:/callback",
  ])("accepts %s", (uri) => expect(RedirectUriSchema.safeParse(uri).success).toBe(true));

  it.each([
    "http://app.example/cb",
    "https://app.example/cb#frag",
    "javascript:alert(1)",
    "https://user@evil.example/",
    "myapp://cb",
    "https://app.example/ cb",
    "data:text/html,hi",
  ])("refuses %s", (uri) => expect(RedirectUriSchema.safeParse(uri).success).toBe(false));
});
