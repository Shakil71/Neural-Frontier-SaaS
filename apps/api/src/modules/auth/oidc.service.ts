import { Inject, Injectable, Logger } from "@nestjs/common";
import * as oidc from "openid-client";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { Errors } from "../../common/errors.js";
import type { LoginState } from "./login-state.js";

export interface VerifiedClaims {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** OIDC relying party: authorization code flow with PKCE, state and nonce. */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private discovered: Promise<oidc.Configuration> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get configured(): boolean {
    return this.config.oidc !== null;
  }

  get redirectUri(): string {
    return new URL("/api/v1/auth/callback", this.config.publicUrl).toString();
  }

  private async client(): Promise<oidc.Configuration> {
    const c = this.config.oidc;
    if (!c) throw Errors.unavailable("Single sign-on is not configured for this deployment");
    // Discovery is cached; a failure clears the cache so the next sign-in retries.
    this.discovered ??= oidc
      .discovery(
        c.issuer,
        c.clientId,
        undefined,
        oidc.ClientSecretPost(c.clientSecret),
        c.allowInsecureHttp ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((err: unknown) => {
        this.discovered = null;
        this.logger.error({ err }, "OIDC discovery failed");
        throw Errors.unavailable("The identity provider is unreachable");
      });
    return this.discovered;
  }

  async beginLogin(returnTo: string): Promise<{ url: URL; state: LoginState }> {
    const client = await this.client();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state: LoginState = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier,
      returnTo,
    };
    const url = oidc.buildAuthorizationUrl(client, {
      redirect_uri: this.redirectUri,
      scope: "openid email profile",
      response_type: "code",
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state: state.state,
      nonce: state.nonce,
    });
    return { url, state };
  }

  /** Exchanges the code, validating state, nonce, PKCE and the ID token signature. */
  async completeLogin(callbackUrl: URL, state: LoginState): Promise<VerifiedClaims> {
    const client = await this.client();
    const tokens = await oidc.authorizationCodeGrant(client, callbackUrl, {
      pkceCodeVerifier: state.codeVerifier,
      expectedState: state.state,
      expectedNonce: state.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw Errors.unauthenticated("The identity provider returned no ID token");
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    return {
      issuer: claims.iss,
      subject: claims.sub,
      email,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === "string" ? claims.name : null,
    };
  }
}
