/**
 * Neural Frontier — DEVELOPMENT / TEST identity provider.
 *
 * A real OpenID Connect provider (panva/oidc-provider) so the full sign-in flow — discovery,
 * PKCE, state, nonce, signed ID tokens — runs locally and in end-to-end tests exactly as it
 * does against a production IdP.
 *
 * Sign in by typing any email address as the login (any password). The email's domain decides
 * the tenant, so use one you bootstrapped (e.g. owner@acme.example).
 *
 * It refuses to start when NODE_ENV=production. It is never packaged or deployed.
 */
import Provider from "oidc-provider";

if (process.env.NODE_ENV === "production") {
  console.error("dev-idp must never run in production. Refusing to start.");
  process.exit(1);
}

const port = Number(process.env.DEV_IDP_PORT ?? 3499);
const issuer = process.env.DEV_IDP_ISSUER ?? `http://localhost:${port}`;
const webOrigin = process.env.DEV_IDP_WEB_ORIGIN ?? "http://localhost:3400";

const nameFrom = (email) =>
  email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ") || email;

const provider = new Provider(issuer, {
  clients: [
    {
      client_id: process.env.DEV_IDP_CLIENT_ID ?? "neural-frontier-dev",
      client_secret: process.env.DEV_IDP_CLIENT_SECRET ?? "dev-secret-not-for-production",
      redirect_uris: [`${webOrigin}/api/v1/auth/callback`],
      post_logout_redirect_uris: [`${webOrigin}/sign-in`],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    },
  ],
  pkce: { required: () => true },
  claims: { openid: ["sub"], email: ["email", "email_verified"], profile: ["name"] },
  scopes: ["openid", "email", "profile"],
  features: { devInteractions: { enabled: true } },
  cookies: { keys: ["dev-idp-cookie-key-not-for-production"] },
  ttl: {
    Session: 3600,
    Interaction: 600,
    Grant: 3600,
    AccessToken: 600,
    IdToken: 600,
    AuthorizationCode: 60,
  },
  // The "login" typed into the dev form becomes the subject and the email address.
  async findAccount(_ctx, sub) {
    const email = String(sub).trim().toLowerCase();
    return {
      accountId: email,
      async claims() {
        return { sub: email, email, email_verified: email.includes("@"), name: nameFrom(email) };
      },
    };
  },
  // Skip the consent screen: this IdP only serves the first-party Neural Frontier client.
  async loadExistingGrant(ctx) {
    const clientId = ctx.oidc.client.clientId;
    const grantId = ctx.oidc.result?.consent?.grantId ?? ctx.oidc.session.grantIdFor(clientId);
    if (grantId) return ctx.oidc.provider.Grant.find(grantId);
    const grant = new ctx.oidc.provider.Grant({ clientId, accountId: ctx.oidc.session.accountId });
    grant.addOIDCScope("openid email profile");
    await grant.save();
    return grant;
  },
});

provider.listen(port, () => {
  console.log(`dev-idp (DEVELOPMENT ONLY) listening on ${issuer}`);
});
