import { expect, type Page, test } from "@playwright/test";

async function signInAs(page: Page, email: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2F/);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: /Continue with single sign-on/ }).click();
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
  await page.getByRole("button", { name: /Continue with single sign-on/ }).click();
  await page.locator('input[name="login"]').fill("stranger@unknown-org.example");
  await page.locator('input[name="password"]').fill("e2e");
  await page.locator('button[type="submit"]').click();
  // (Next.js' route announcer is also role="alert", so match the message itself.)
  await expect(page.getByText("isn't registered with Neural Frontier")).toBeVisible();
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
  await grant.getByLabel("Role").selectOption({ label: "Security Auditor — 7 permissions" });
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
    ["08-directory", "/directory", "No directory connected yet"],
    ["09-connectors", "/connectors", "No directories connected"],
    ["10-service-principals", "/service-principals", "Service principals"],
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

test("owner creates a service principal; the secret is shown once and works", async ({
  page,
  request,
}) => {
  await signInAs(page, "ada.owner@acme.example");
  await page.goto("/service-principals");
  await page.getByRole("button", { name: "New service principal" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New service principal" });
  await dialog.getByLabel("Name").fill("E2E reporting bot");
  await dialog.getByRole("button", { name: "Create and issue secret" }).click();

  const reveal = page.getByRole("dialog", { name: "Copy the client secret now" });
  await expect(reveal).toBeVisible();
  const clientId = (await reveal.locator("code").nth(0).textContent()) ?? "";
  const clientSecret = (await reveal.locator("code").nth(1).textContent()) ?? "";
  expect(clientSecret).toMatch(/^nfs_/);
  await page.screenshot({ path: "test-results/screenshots/11-secret-reveal-light.png" });
  await expect(reveal.getByRole("button", { name: "Done" })).toBeDisabled();
  await reveal.getByLabel("I have stored the secret somewhere safe").check();
  await reveal.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Open E2E reporting bot" })).toBeVisible();

  // The issued credential works against the token endpoint and the directory API.
  const tokenRes = await request.post("/api/v1/oauth/token", {
    form: { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret },
  });
  expect(tokenRes.status()).toBe(200);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const users = await request.get("/api/v1/directory/users", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  expect(users.status()).toBe(200);

  await page.goto("/connectors");
  await page.getByRole("button", { name: "Connect directory" }).first().click();
  await expect(page.getByRole("dialog", { name: "Connect Microsoft Entra ID" })).toBeVisible();
  await page.screenshot({ path: "test-results/screenshots/12-connect-directory-light.png" });
});

/** Fills the development IdP's login form (any password). */
async function idpLogin(page: Page, email: string) {
  await page.locator('input[name="login"]').fill(email);
  await page.locator('input[name="password"]').fill("e2e");
  await page.locator('button[type="submit"]').click();
}

test("signing out also ends the identity provider session (single sign-out)", async ({ page }) => {
  await signInAs(page, "ada.owner@acme.example");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  // The provider asks to confirm (dev IdP behaviour), then returns to our sign-in page.
  await expect(page).toHaveURL(/localhost:3499\//);
  await page.getByRole("button", { name: "Yes, sign me out" }).click();
  await expect(page).toHaveURL(/localhost:3400\/sign-in\?.*state=signed-out/);
  await expect(page.getByText("You've been signed out.")).toBeVisible();

  // The provider session is gone: signing in asks for credentials again.
  await page.getByLabel("Work email").fill("ada.owner@acme.example");
  await page.getByRole("button", { name: /Continue with single sign-on/ }).click();
  await expect(page.locator('input[name="login"]')).toBeVisible();
});

// Runs last: it changes how the Acme tenant signs in.
test("an organisation brings its own sign-in provider and can require it", async ({ page }) => {
  await signInAs(page, "ada.owner@acme.example");
  await page.goto("/settings");
  await expect(
    page.getByText(/Connect your provider|Your organisation's provider/).first(),
  ).toBeVisible();

  const connect = page.getByRole("button", { name: "Connect your provider" });
  if (await connect.isVisible()) {
    await connect.click();
    const form = page.getByRole("dialog", { name: "Connect your sign-in provider" });
    await form.getByLabel("Issuer URL").fill("http://localhost:3498");
    await form.getByLabel("Client ID").fill("acme-own-idp");
    await form.getByLabel("Client secret").fill("acme-own-secret-not-for-production");
    await page.screenshot({ path: "test-results/screenshots/13-connect-sso-light.png" });
    await form.getByRole("button", { name: "Connect provider" }).click();
    await expect(page.getByText("Sign-in provider saved")).toBeVisible();
  }
  await expect(page.getByText("http://localhost:3498")).toBeVisible();

  // Email-first sign-in now goes to the organisation's own provider (port 3498, not 3499).
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill("ada.owner@acme.example");
  await page.getByRole("button", { name: /Continue with single sign-on/ }).click();
  await expect(page).toHaveURL(/localhost:3498\//);
  await idpLogin(page, "ada.owner@acme.example");
  await expect(page).toHaveURL(/localhost:3400\/$/);

  // Having signed in through it, the owner may require it.
  await page.goto("/settings");
  await expect(page.getByText("http://localhost:3498")).toBeVisible();
  const requireButton = page.getByRole("button", { name: "Require for everyone" });
  if (await requireButton.isVisible()) {
    await requireButton.click();
    const dialog = page.getByRole("dialog", { name: "Require your provider?" });
    await dialog.getByLabel("Reason").fill("One front door with our MFA");
    await dialog.getByRole("button", { name: "Require" }).click();
    await expect(page.getByText("Provider is now required")).toBeVisible();
  }
  await expect(page.getByText("Required", { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: "test-results/screenshots/14-sso-required-light.png",
    fullPage: true,
  });

  // The deployment's shared provider is now refused for this organisation.
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Continue with single sign-on/ }).click();
  await expect(page).toHaveURL(/localhost:3499\//);
  await idpLogin(page, "ada.owner@acme.example");
  await expect(page.getByText("requires its own sign-in provider")).toBeVisible();
});
