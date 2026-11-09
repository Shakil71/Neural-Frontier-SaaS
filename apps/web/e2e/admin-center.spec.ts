import { expect, type Page, test } from "@playwright/test";

async function signInAs(page: Page, email: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2F/);
  await page.getByRole("link", { name: /Continue with single sign-on/ }).click();
  // Development IdP login form (any password).
  await page.locator('input[name="login"]').fill(email);
  await page.locator('input[name="password"]').fill("e2e");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/localhost:3400\/$/);
}

test("unauthenticated visitors are sent to sign-in, with a nonce-based CSP", async ({ page }) => {
  const res = await page.goto("/identities");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fidentities/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
});

test("unknown organisations get a clear explanation", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: /Continue with single sign-on/ }).click();
  await page.locator('input[name="login"]').fill("stranger@unknown-org.example");
  await page.locator('input[name="password"]').fill("e2e");
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("alert")).toContainText("isn't registered with Neural Frontier");
});

test("owner signs in, grants a role, and the change is audited", async ({ page }) => {
  await signInAs(page, "ada.owner@acme.example");

  // Live dashboard.
  await expect(page.getByRole("heading", { name: /Ada/ })).toBeVisible();
  await expect(page.getByText("Sign-in activity")).toBeVisible();
  await expect(page.getByText("Identities", { exact: true }).first()).toBeVisible();

  // Grant Security Auditor to Grace.
  await page.getByRole("link", { name: "Identities" }).click();
  await page.getByRole("row", { name: /Open Grace Analyst/ }).click();
  const sheet = page.getByRole("dialog", { name: "Grace Analyst" });
  await sheet.getByRole("button", { name: "Grant role" }).click();
  const grant = page.getByRole("dialog", { name: /Grant a role/ });
  await grant.getByLabel("Role").selectOption({ label: "Security Auditor — 4 permissions" });
  await grant.getByLabel("Reason").fill("Quarterly access review");
  await grant.getByRole("button", { name: "Grant role" }).click();
  await expect(page.getByText("Role granted")).toBeVisible();
  await expect(sheet.getByText("Security Auditor")).toBeVisible();
  await page.keyboard.press("Escape");

  // The audit log shows it, with the reason.
  await page.getByRole("link", { name: "Audit log" }).click();
  await page
    .getByRole("row", { name: /View Role granted event/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("Quarterly access review");
  await page.keyboard.press("Escape");

  // Command palette navigates.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search pages and actions" }).fill("health");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
  await expect(page.getByText("MySQL")).toBeVisible();

  // Sign out ends the session.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByText("You've been signed out.")).toBeVisible();
  await page.goto("/audit");
  await expect(page).toHaveURL(/\/sign-in/);
});

/** Captures every screen in both themes; CI uploads them as the `ui-screenshots` artifact. */
test("visual tour (screenshots)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sign-in");
  await page.screenshot({ path: "test-results/screenshots/00-sign-in.png" });
  await signInAs(page, "ada.owner@acme.example");

  const screens = [
    ["01-overview", "/", "Sign-in activity"],
    ["02-identities", "/identities", "Grace Analyst"],
    ["03-roles", "/roles", "Permission matrix"],
    ["04-audit", "/audit", "Audit log"],
    ["05-system", "/system", "MySQL"],
    ["06-organisation", "/settings", "Domains"],
  ] as const;
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((t) => localStorage.setItem("theme", t), theme);
    for (const [name, path, marker] of screens) {
      await page.goto(path);
      await expect(page.getByText(marker).first()).toBeVisible();
      await page.waitForTimeout(600); // let entrance animations and charts settle
      await page.screenshot({
        path: `test-results/screenshots/${name}-${theme}.png`,
        fullPage: true,
      });
    }
  }
  await page.goto("/identities");
  await page.getByRole("row", { name: /Open Grace Analyst/ }).click();
  await expect(page.getByRole("dialog", { name: "Grace Analyst" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/screenshots/07-identity-sheet-light.png" });
});
