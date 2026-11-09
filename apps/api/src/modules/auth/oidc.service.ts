import { Inject, Injectable, Logger } from "@nestjs/common";
import * as oidc from "openid-client";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { Errors } from "../../common/errors.js";
import { unseal } from "../../common/sealed.js";
import { DatabaseService } from "../../infra/database.service.js";
import type { LoginState } from "./login-state.js";

export interface VerifiedClaims {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Which OIDC provider a sign-in goes through.
 * - `global`: the deployment-wide provider from NF_OIDC_* (may serve every tenant).
 * - `tenant:<id>`: a tenant's own provider; it can only sign people in to that tenant.
 */
export type ProviderKey = "global" | `tenant:${string}`;

export interface ProviderContext {
  key: ProviderKey;
  /** Set for a tenant provider: the only tenant it may sign people in to. */
  tenantId: string | null;
  requireEmailVerified: boolean;
}

interface ResolvedProvider extends ProviderContext {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  /** Changes when the configuration changes, so cached discovery is refreshed. */
  cacheKey: string;
}

export const tenantIdpSecretContext = (tenantId: string) => `tenant-idp-secret:${tenantId}`;

/** OIDC relying party: authorization code flow with PKCE, state and nonce, per provider. */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private readonly discovered = new Map<string, Promise<oidc.Configuration>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
  ) {}

  /** True when the deployment-wide provider is configured. */
  get configured(): boolean {
    return this.config.oidc !== null;
  }

  get redirectUri(): string {
    return new URL("/api/v1/auth/callback", this.config.publicUrl).toString();
  }

  private discoveryOptions() {
    return this.config.oidcAllowInsecureHttp
      ? { execute: [oidc.allowInsecureRequests] }
      : undefined;
  }

  /** Runs discovery for an issuer without caching it (used to validate a tenant's settings). */
  /** Returns the issuer exactly as the provider states it (what ID tokens carry in `iss`). */
  async probe(issuer: URL, clientId: string, clientSecret: string): Promise<string> {
    const c = await oidc.discovery(
      issuer,
      clientId,
      undefined,
      oidc.ClientSecretPost(clientSecret),
      this.discoveryOptions(),
    );
    const meta = c.serverMetadata();
    if (!meta.authorization_endpoint || !meta.token_endpoint) {
      throw new Error("The provider's discovery document has no authorization or token endpoint");
    }
    return meta.issuer;
  }

  private async resolve(key: ProviderKey): Promise<ResolvedProvider | null> {
    if (key === "global") {
      const c = this.config.oidc;
      if (!c) return null;
      return {
        key,
        tenantId: null,
        requireEmailVerified: c.requireEmailVerified,
        issuer: c.issuer,
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        cacheKey: "global",
      };
    }
    const tenantId = key.slice("tenant:".length);
    if (!this.config.dataKey) return null;
    const row = await this.database.db.tenantIdentityProvider.findUnique({
      where: { tenantId, tenant: { status: "active" } },
    });
    if (!row) return null;
    return {
      key,
      tenantId,
      requireEmailVerified: row.requireEmailVerified,
      issuer: new URL(row.issuer),
      clientId: row.clientId,
      clientSecret: unseal(
        this.config.dataKey,
        new Uint8Array(row.secretCiphertext),
        tenantIdpSecretContext(tenantId),
      ),
      cacheKey: `${key}:${row.version}`,
    };
  }

  private client(p: ResolvedProvider): Promise<oidc.Configuration> {
    let pending = this.discovered.get(p.cacheKey);
    if (!pending) {
      // Discovery is cached per provider version; a failure clears it so the next try retries.
      pending = oidc
        .discovery(
          p.issuer,
          p.clientId,
          undefined,
          oidc.ClientSecretPost(p.clientSecret),
          this.discoveryOptions(),
        )
        .catch((err: unknown) => {
          this.discovered.delete(p.cacheKey);
          this.logger.error({ err, provider: p.key }, "OIDC discovery failed");
          throw Errors.unavailable("The identity provider is unreachable");
        });
      this.discovered.set(p.cacheKey, pending);
    }
    return pending;
  }

  /**
   * Picks the provider for a sign-in. With an email whose verified domain belongs to a tenant
   * that has its own provider, that provider is used; otherwise the deployment-wide one.
   * Returns null if no provider can serve this sign-in.
   */
  async chooseProvider(email: string | null): Promise<ProviderKey | null> {
    const domain = email?.split("@")[1]?.toLowerCase();
    if (domain && this.config.dataKey) {
      // Cross-tenant by definition: the email domain selects the tenant.
      const td = await this.database.system.tenantDomain.findUnique({
        where: { domain },
        include: { tenant: { include: { identityProvider: true } } },
      });
      if (td?.verifiedAt && td.tenant.identityProvider) return `tenant:${td.tenantId}`;
    }
    return this.configured ? "global" : null;
  }

  async beginLogin(
    returnTo: string,
    key: ProviderKey,
    loginHint: string | null,
  ): Promise<{ url: URL; state: LoginState }> {
    const provider = await this.resolve(key);
    if (!provider) throw Errors.unavailable("Single sign-on is not configured");
    const client = await this.client(provider);
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state: LoginState = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier,
      returnTo,
      provider: key,
    };
    const url = oidc.buildAuthorizationUrl(client, {
      redirect_uri: this.redirectUri,
      scope: "openid email profile",
      response_type: "code",
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state: state.state,
      nonce: state.nonce,
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
    return { url, state };
  }

  /**
   * Exchanges the code with the provider the sign-in started at, validating state, nonce,
   * PKCE and the ID token signature.
   */
  async completeLogin(
    callbackUrl: URL,
    state: LoginState,
  ): Promise<{ claims: VerifiedClaims; context: ProviderContext }> {
    const provider = await this.resolve(state.provider);
    if (!provider) throw Errors.unauthenticated("This sign-in's identity provider was removed");
    const client = await this.client(provider);
    const tokens = await oidc.authorizationCodeGrant(client, callbackUrl, {
      pkceCodeVerifier: state.codeVerifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw Errors.unauthenticated("The identity provider returned no ID token");

    // Many providers put email/profile only in the UserInfo response, not the ID token.
    // UserInfo is bound to the ID token subject, so it cannot substitute another user's claims.
    let profile: Record<string, unknown> = claims;
    if (typeof claims.email !== "string" && tokens.access_token) {
      profile = {
        ...(await oidc.fetchUserInfo(client, tokens.access_token, claims.sub)),
        ...claims,
      };
    }
    const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
    return {
      claims: {
        issuer: claims.iss,
        subject: claims.sub,
        email,
        emailVerified: profile.email_verified === true,
        name: typeof profile.name === "string" ? profile.name : null,
      },
      context: {
        key: provider.key,
        tenantId: provider.tenantId,
        requireEmailVerified: provider.requireEmailVerified,
      },
    };
  }
}
