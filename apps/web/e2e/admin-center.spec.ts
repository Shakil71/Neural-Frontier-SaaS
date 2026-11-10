import { type AddressInfo, createServer } from "node:net";
import { createHmac } from "node:crypto";
import * as oidc from "openid-client";
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
  // Select by role name: the permission count in the label grows as features are added.
  const auditorOption = grant.locator("option", { hasText: "Security Auditor" });
  await grant.getByLabel("Role").selectOption((await auditorOption.getAttribute("value")) ?? "");
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
  // Single sign-out: the dev IdP asks to confirm before ending its session.
  await page.getByRole("button", { name: "Yes, sign me out" }).click();
  await expect(page.getByText("You've been signed out.")).toBeVisible();
  await page.goto("/audit");
  await expect(page).toHaveURL(/\/sign-in/);
});

/** Captures every screen in both themes; CI uploads them as the `ui-screenshots` artifact. */
test("visual tour (screenshots)", async ({ page }) => {
  test.setTimeout(90_000); // 18 full-page screenshots
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

test("an administrator adds a server; the agent's report appears in the Admin Center", async ({
  page,
  request,
}) => {
  await signInAs(page, "ada.owner@acme.example");
  await page.goto("/servers");
  await page.getByRole("button", { name: "Add server" }).first().click();
  await page
    .getByRole("dialog", { name: "Add a Linux server" })
    .getByRole("button", { name: "Create key" })
    .click();
  const done = page.getByRole("dialog", { name: "Run this on the server" });
  const command = (await done.locator("code").textContent()) ?? "";
  const key = /--key (nfe_[A-Za-z0-9_-]+)/.exec(command)?.[1] ?? "";
  expect(key).not.toBe("");
  await page.screenshot({ path: "test-results/screenshots/15-add-server-light.png" });
  await done.getByRole("button", { name: "Done" }).click();

  // What the agent does: enrol with the key, then report inventory with its own token.
  const machineId = "e2e0000000000000000000000000a001";
  const enrolled = await request.post("/api/agent/v1/enroll", {
    data: { enrollmentKey: key, machineId, hostname: "app-01" },
  });
  expect(enrolled.status()).toBe(200);
  const { agentToken } = (await enrolled.json()) as { agentToken: string };
  const report = await request.post("/api/agent/v1/inventory", {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: {
      agentVersion: "e2e",
      collectedAt: new Date().toISOString(),
      hostname: "app-01.acme.example",
      machineId,
      os: {
        id: "ol",
        name: "Oracle Linux Server",
        version: "9.8",
        prettyName: "Oracle Linux Server 9.8",
        kernel: "5.15.0-300.el9uek.x86_64",
        arch: "amd64",
      },
      cpu: { model: "AMD EPYC 7763 64-Core Processor", cores: 8 },
      memory: { totalBytes: 34359738368, availableBytes: 21474836480 },
      uptimeSeconds: 1_209_600,
      loadAverage: [0.62, 0.48, 0.41],
      disks: [
        {
          mount: "/",
          device: "/dev/mapper/ol-root",
          fsType: "xfs",
          sizeBytes: 107374182400,
          usedBytes: 41875931136,
        },
        {
          mount: "/data",
          device: "/dev/sdb1",
          fsType: "xfs",
          sizeBytes: 536870912000,
          usedBytes: 498216206336,
        },
      ],
      interfaces: [
        {
          name: "ens192",
          mac: "00:50:56:a1:b2:c3",
          addresses: ["10.20.0.15/24", "fe80::250:56ff:fea1:b2c3/64"],
        },
      ],
      services: [
        { name: "nginx.service", description: "The nginx HTTP and reverse proxy server" },
        { name: "sshd.service", description: "OpenSSH server daemon" },
        { name: "chronyd.service", description: "NTP client/server" },
      ],
      packages: [
        { name: "bash", version: "5.1.8-9.el9.x86_64" },
        { name: "nginx", version: "1.26.3-1.el9.x86_64" },
        { name: "openssl", version: "3.2.2-6.el9.x86_64" },
      ],
      packageManager: "rpm",
      packagesHash: "c".repeat(64),
      packageCount: 3,
      // Network exposure: Redis on a public address with no firewall, SSH accepting passwords.
      listeners: [
        { proto: "tcp", address: "0.0.0.0", port: 22, user: "root", process: "sshd" },
        { proto: "tcp", address: "0.0.0.0", port: 443, user: "root", process: "nginx" },
        { proto: "tcp", address: "203.0.113.20", port: 6379, user: "redis", process: "" },
        { proto: "tcp", address: "127.0.0.1", port: 3306, user: "mysql", process: "" },
      ],
      firewall: {
        kind: "none",
        active: false,
        rulesKnown: false,
        defaultAllow: false,
        zones: [],
        allowed: [],
      },
      ssh: {
        present: true,
        ports: [22],
        permitRootLogin: "no",
        passwordAuthentication: "yes",
        kbdInteractiveAuthentication: "no",
        usePam: "yes",
        permitEmptyPasswords: "no",
      },
    },
  });
  expect(report.status()).toBe(204);

  await page.reload();
  await expect(page.getByRole("button", { name: "Open app-01.acme.example" })).toBeVisible();
  await expect(page.getByText("Disk ≥ 90% full")).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-results/screenshots/16-servers-light.png", fullPage: true });
  await page.getByRole("button", { name: "Open app-01.acme.example" }).click();
  const sheet = page.getByRole("dialog", { name: "app-01.acme.example" });
  await expect(sheet.getByText("AMD EPYC 7763 64-Core Processor")).toBeVisible();
  await sheet.getByRole("tab", { name: /Packages/ }).click();
  await expect(sheet.getByText("openssl")).toBeVisible();
  await page.screenshot({ path: "test-results/screenshots/17-server-detail-light.png" });

  // Exposure: the Security tab shows the analysis of the same report.
  await sheet.getByRole("tab", { name: /Security/ }).click();
  await expect(sheet.getByText("Redis (tcp/6379) is reachable from the internet")).toBeVisible();
  await expect(sheet.getByText("No firewall is running")).toBeVisible();
  await expect(sheet.getByText("SSH accepts passwords")).toBeVisible();
  await expect(sheet.getByRole("cell", { name: /MySQL/ })).toBeVisible();
  await page.screenshot({ path: "test-results/screenshots/18-server-security-light.png" });
  await page.keyboard.press("Escape");

  // The banner leads to the organisation-wide Exposure page, where the risk is accepted.
  await page.getByRole("link", { name: /high-severity findings? on 1 server/ }).click();
  await expect(page).toHaveURL(/\/exposure$/);
  await expect(page.getByRole("heading", { name: "Exposure" })).toBeVisible();
  const redis = page
    .getByRole("listitem")
    .filter({ hasText: "Redis (tcp/6379) is reachable from the internet" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/screenshots/19-exposure-light.png", fullPage: true });
  await redis.getByRole("button", { name: "Accept risk…" }).click();
  const accept = page.getByRole("dialog", { name: "Accept this risk?" });
  await accept
    .getByLabel("Why is this acceptable?")
    .fill("Upstream firewall allows only the app tier");
  await accept.getByRole("button", { name: "Accept risk" }).click();
  await expect(page.getByText("Finding accepted. It no longer counts as open.")).toBeVisible();
  await page.getByRole("tab", { name: /Accepted/ }).click();
  await expect(page.getByText("“Upstream firewall allows only the app tier”")).toBeVisible();

  // Recorded in the audit log.
  await page.goto("/audit");
  await expect(page.getByRole("row", { name: "View Finding accepted event" })).toBeVisible();
});

/** RFC 6238 code, computed independently of the app (base32 seed → HMAC-SHA1). */
function totp(base32: string, stepOffset = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/\s/g, ""))
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepOffset));
  const mac = createHmac("sha1", key).update(msg).digest();
  const o = mac[19]! & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("built-in sign-in: a set-up link, a password, then two-step sign-in", async ({
  page,
  browser,
}) => {
  const PASSWORD = "amber-falcon-orchard-91";
  // The owner issues Grace a one-time sign-in link.
  await signInAs(page, "ada.owner@acme.example");
  await page.getByRole("link", { name: "Identities" }).click();
  await page.getByRole("row", { name: /Open Grace Analyst/ }).click();
  const sheet = page.getByRole("dialog", { name: "Grace Analyst" });
  await sheet.getByRole("button", { name: /Create sign-in link|Send password reset link/ }).click();
  const issue = page.getByRole("dialog", { name: /Create a sign-in link/ });
  await issue.getByRole("button", { name: "Create link" }).click();
  const share = page.getByRole("dialog", { name: "Share this link" });
  const url = (await share.locator("code").textContent()) ?? "";
  expect(url).toMatch(/\/sign-in\/setup#nfl_/);
  await page.screenshot({ path: "test-results/screenshots/18-sign-in-link-light.png" });
  await share.getByRole("button", { name: "Done" }).click();

  // Grace, in her own browser, sets a password with the link.
  const grace = await (await browser.newContext()).newPage();
  await grace.goto(url);
  await expect(
    grace.getByRole("heading", { name: /Welcome, Grace|Choose a new password/ }),
  ).toBeVisible();
  await expect(grace).toHaveURL(/\/sign-in\/setup$/); // the token left the address bar
  await grace.getByLabel("New password", { exact: true }).fill("password");
  await expect(grace.getByText("Not a commonly used password")).toBeVisible();
  await grace.getByLabel("New password", { exact: true }).fill(PASSWORD);
  await grace.getByLabel("Confirm password").fill(PASSWORD);
  await grace.screenshot({ path: "test-results/screenshots/19-set-password-dark.png" });
  await grace.getByRole("button", { name: /Set password|Save new password/ }).click();
  await expect(grace.getByRole("heading", { name: "Your password is set" })).toBeVisible();

  // …and signs in with it.
  await grace.getByRole("link", { name: "Continue to sign in" }).click();
  await expect(grace.getByText("Your password is set. Sign in with it now.")).toBeVisible();
  await grace.getByRole("button", { name: "Continue", exact: true }).click();
  await grace.getByLabel("Password", { exact: true }).fill("not-her-password");
  await grace.getByRole("button", { name: "Sign in" }).click();
  await expect(grace.getByText("Incorrect email or password.")).toBeVisible();
  await grace.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await grace.getByRole("button", { name: "Sign in" }).click();
  await expect(grace).toHaveURL(/localhost:3400\/$/);

  // Turns on two-step sign-in from My account.
  await grace.getByRole("button", { name: "Account menu" }).click();
  await grace.getByRole("menuitem", { name: "Security & sign-in" }).click();
  await expect(grace.getByRole("heading", { name: "Security & sign-in" })).toBeVisible();
  await expect(grace.getByText("Signed in with password")).toBeVisible();
  await grace.getByRole("button", { name: "Set up authenticator app" }).click();
  const setup = grace.getByRole("dialog", { name: "Set up two-step sign-in" });
  await expect(setup.getByRole("img", { name: /QR code/ })).toBeVisible();
  const secret = (await setup.locator("code").textContent()) ?? "";
  await grace.screenshot({ path: "test-results/screenshots/20-two-step-setup-light.png" });
  await setup.getByLabel("6-digit code").fill(totp(secret));
  await setup.getByRole("button", { name: "Turn on" }).click();
  const saved = grace.getByRole("dialog", { name: "Save your recovery codes" });
  await expect(saved.locator("li")).toHaveCount(10);
  await expect(saved.getByRole("button", { name: "Done" })).toBeDisabled();
  await saved.getByLabel(/I've saved these codes/).check();
  await saved.getByRole("button", { name: "Done" }).click();
  await expect(grace.getByText("10 of 10")).toBeVisible();

  // Next sign-in asks for the code (a later step: the one used to turn it on is spent).
  await grace.getByRole("button", { name: "Account menu" }).click();
  await grace.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(grace.getByText("You've been signed out.")).toBeVisible();
  await grace.getByLabel("Work email").fill("grace.analyst@acme.example");
  await grace.getByRole("button", { name: "Continue", exact: true }).click();
  await grace.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await grace.getByRole("button", { name: "Sign in" }).click();
  await expect(grace.getByText("Enter the code from your authenticator app")).toBeVisible();
  await grace.screenshot({ path: "test-results/screenshots/21-two-step-sign-in-dark.png" });
  await grace.getByLabel("Authentication code").fill(totp(secret, 1));
  await grace.getByRole("button", { name: "Verify" }).click();
  await expect(grace).toHaveURL(/localhost:3400\/$/);

  // The owner sees it all in Grace's sign-in panel and the audit log.
  await page.reload();
  await page.getByRole("row", { name: /Open Grace Analyst/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Grace Analyst" }).getByText("On", { exact: true }),
  ).toBeVisible();
  await page.goto("/audit");
  await expect(page.getByRole("row", { name: /Two-factor turned on/ }).first()).toBeVisible();
  await grace.context().close();
});

/** A tiny SMTP server that records messages (the organisation's "mail server" in this test). */
async function mailSink() {
  const received: string[] = [];
  const server = createServer((socket) => {
    let buf = "";
    let inData = false;
    let body: string[] = [];
    const send = (l: string) => socket.write(`${l}\r\n`);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            received.push(body.join("\n"));
            body = [];
            send("250 Ok: queued");
          } else body.push(line);
          continue;
        }
        const verb = line.split(" ")[0]!.toUpperCase();
        if (verb === "EHLO") send("250 sink.e2e");
        else if (verb === "DATA") {
          inData = true;
          send("354 Go ahead");
        } else if (verb === "QUIT") {
          send("221 Bye");
          socket.end();
        } else send("250 Ok");
      }
    });
    send("220 sink.e2e ESMTP");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { port, received, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("email delivery is set up and tested from the GUI; sessions are listed", async ({ page }) => {
  const sink = await mailSink();
  try {
    await signInAs(page, "ada.owner@acme.example");
    await page.goto("/settings");
    await page.getByRole("button", { name: "Set up email" }).click();
    const form = page.getByRole("dialog", { name: "Set up email delivery" });
    await form.getByRole("button", { name: "Relay on this server" }).click();
    await form.getByLabel("Port").fill(String(sink.port));
    await form.getByLabel("Sender address").fill("no-reply@acme.example");
    await page.screenshot({ path: "test-results/screenshots/22-email-setup-light.png" });
    await form.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Not tested yet")).toBeVisible();

    await page.getByRole("button", { name: "Send me a test" }).click();
    await expect(page.getByText("Test sent to ada.owner@acme.example")).toBeVisible();
    await expect(page.getByText("Working", { exact: true })).toBeVisible();
    expect(sink.received).toHaveLength(1);
    expect(sink.received[0]).toContain("To: <ada.owner@acme.example>");
    await page.screenshot({
      path: "test-results/screenshots/23-email-working-light.png",
      fullPage: true,
    });

    // The sign-in page now offers "Forgot password?" for this organisation.
    const fresh = await (await page.context().browser()!.newContext()).newPage();
    await fresh.goto("/sign-in");
    await fresh.getByLabel("Work email").fill("grace.analyst@acme.example");
    await fresh.getByRole("button", { name: "Continue", exact: true }).click();
    await fresh.getByRole("button", { name: "Forgot password?" }).click();
    await expect(fresh.getByText("Check your email")).toBeVisible();
    await fresh.context().close();

    // My account lists this browser's session.
    await page.goto("/account/security");
    await expect(page.getByText("Where you're signed in")).toBeVisible();
    await expect(page.getByText("This browser")).toBeVisible();
    await page.screenshot({
      path: "test-results/screenshots/24-sessions-dark.png",
      fullPage: true,
    });
  } finally {
    await sink.close();
  }
});

test("an application signs people in with Neural Frontier (checked by an independent OIDC client)", async ({
  page,
}) => {
  const CALLBACK = "http://localhost:3496/callback";
  await signInAs(page, "ada.owner@acme.example");

  // Register the app in the Admin Center.
  await page.getByRole("link", { name: "Applications" }).click();
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();
  await page.getByRole("button", { name: "Register application" }).first().click();
  const form = page.getByRole("dialog", { name: "Register an application" });
  await form.getByLabel("Name").fill("Partner portal");
  await form.getByLabel("Redirect addresses (one per line)").fill(CALLBACK);
  await page.screenshot({ path: "test-results/screenshots/25-register-app-light.png" });
  await form.getByRole("button", { name: "Register application" }).click();
  const issued = page.getByRole("dialog", { name: "Copy the client secret now" });
  const codes = issued.locator("code");
  const issuer = (await codes.nth(0).textContent()) ?? "";
  const clientId = (await codes.nth(1).textContent()) ?? "";
  const clientSecret = (await codes.nth(2).textContent()) ?? "";
  expect(clientSecret).toMatch(/^nfcs_/);
  await issued.getByRole("button", { name: "Done" }).click();

  // The app: a real OpenID Connect client library, not our code.
  const config = await oidc.discovery(new URL(issuer), clientId, clientSecret, undefined, {
    execute: [oidc.allowInsecureRequests],
  });
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const authUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: CALLBACK,
    scope: "openid email profile roles",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });

  // Ada is already signed in, so her browser is sent straight back to the app with a code.
  // (Sent with her browser's cookies; the app's address is read from the redirect, since
  // nothing listens there in this test.)
  const res = await page.request.get(authUrl.toString(), { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  const callback = new URL(res.headers()["location"]!);
  expect(callback.origin + callback.pathname).toBe(CALLBACK);

  const tokens = await oidc.authorizationCodeGrant(config, callback, {
    pkceCodeVerifier: verifier,
    expectedState: state,
    expectedNonce: nonce,
  });
  const claims = tokens.claims()!;
  expect(claims).toMatchObject({
    email: "ada.owner@acme.example",
    email_verified: true,
    roles: ["owner"],
  });
  const info = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
  expect(info.email).toBe("ada.owner@acme.example");

  // The Admin Center shows it was used, and the audit log has the sign-in.
  await page.goto("/applications");
  await expect(page.getByText("Partner portal")).toBeVisible();
  await page.screenshot({
    path: "test-results/screenshots/26-applications-dark.png",
    fullPage: true,
  });
  await page.goto("/audit");
  await expect(
    page.getByRole("row", { name: /Signed in to an application/ }).first(),
  ).toBeVisible();
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
