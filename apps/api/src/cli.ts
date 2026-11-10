import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { EmailSchema } from "@nf/contracts";
import { CliModule } from "./cli.module.js";
import { loadConfig } from "./config/config.js";
import { LocalAuthService } from "./modules/local-auth/local-auth.service.js";

/**
 * Operator commands, run on the server with the API's configuration:
 *
 *   node dist/cli.js sign-in-link <email> "<reason>"
 *
 * Break-glass: issues a one-time link to set or reset a person's password when nobody who
 * could do it from the Admin Center can sign in (a fresh install, or a locked-out owner).
 * Audited as `system:operator`. Anyone who can run this already controls the server.
 */
const USAGE = 'usage: cli.js sign-in-link <email> "<reason>"';

async function main(argv: string[]): Promise<number> {
  const [command, rawEmail, ...reasonParts] = argv;
  if (command !== "sign-in-link" || !rawEmail) {
    console.error(USAGE);
    return 2;
  }
  const email = EmailSchema.safeParse(rawEmail);
  const reason = reasonParts.join(" ").trim();
  if (!email.success || reason.length < 3) {
    console.error(USAGE);
    return 2;
  }

  const app = await NestFactory.createApplicationContext(CliModule.forRoot(loadConfig()), {
    logger: ["error"],
  });
  try {
    const local = app.get(LocalAuthService);
    const who = await local.findByEmail(email.data);
    if (!who) {
      console.error(`No identity with the email ${email.data}.`);
      return 1;
    }
    const link = await local.createSignInLink(
      { kind: "operator", label: "system:operator" },
      who.tenantId,
      who.identityId,
      reason,
      { ipAddress: null, userAgent: "nf-cli", requestId: null },
    );
    const kind = link.purpose === "setup" ? "Set-up" : "Reset";
    process.stdout.write(
      [
        `${kind} link for ${email.data}`,
        `expires ${link.expiresAt} · works once`,
        link.url,
        "",
      ].join("\n"),
    );
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await app.close();
  }
}

process.exitCode = await main(process.argv.slice(2));
