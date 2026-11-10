import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { OIDC_SCOPES } from "@nf/contracts";
import type { OAuthApplication } from "@nf/db";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, SignJWT } from "jose";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../auth/session.service.js";
import { hashToken } from "../auth/tokens.js";
import { ApplicationsService } from "./applications.service.js";
import { SIGNING_ALG, SigningKeys } from "./signing-keys.js";

const CODE_TTL_MS = 60_000;
export const ID_TOKEN_TTL_S = 15 * 60;
export const ACCESS_TOKEN_TTL_S = 15 * 60;
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;

/** An OAuth error, returned to the application (RFC 6749 §4.1.2.1, §5.2). */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

/** A problem we must not redirect for (unknown client or redirect URI): shown to the person. */
export class AuthorizePageError extends Error {
  constructor(
    readonly reason: "unknown_app" | "bad_redirect" | "app_disabled" | "other_organisation",
  ) {
    super(reason);
  }
}

export interface AuthorizeRequest {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  nonce?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  prompt?: string;
  login_hint?: string;
}

export type AuthorizeOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "sign_in"; returnTo: string; loginHint: string | null };

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function withParams(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/**
 * OpenID Connect provider (authorization code flow with mandatory PKCE). Applications are
 * registered per tenant; only people of that tenant (and, optionally, of chosen roles) can use
 * them. Tokens are ES256 JWTs; ID tokens and access tokens live 15 minutes.
 */
@Injectable()
export class OidcProviderService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly apps: ApplicationsService,
    private readonly keys: SigningKeys,
  ) {}

  get issuer(): string {
    return this.apps.issuer;
  }

  discovery() {
    const i = this.issuer;
    return {
      issuer: i,
      authorization_endpoint: `${i}/authorize`,
      token_endpoint: `${i}/token`,
      userinfo_endpoint: `${i}/userinfo`,
      jwks_uri: `${i}/jwks`,
      end_session_endpoint: `${i}/logout`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: [SIGNING_ALG],
      scopes_supported: [...OIDC_SCOPES],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      code_challenge_methods_supported: ["S256"],
      claims_supported: [
        "sub",
        "iss",
        "aud",
        "exp",
        "iat",
        "auth_time",
        "nonce",
        "sid",
        "email",
        "email_verified",
        "name",
        "preferred_username",
        "roles",
        "tid",
      ],
      authorization_response_iss_parameter_supported: true,
      prompt_values_supported: ["none", "login"],
    };
  }

  async jwks() {
    return { keys: await this.keys.publicKeys() };
  }

  // ───────────── Authorization endpoint ─────────────

  async authorize(
    q: AuthorizeRequest,
    principal: Principal | null,
    rawQuery: string,
    meta: RequestMeta,
  ): Promise<AuthorizeOutcome> {
    const app = await this.apps.byClientId(str(q.client_id) ?? "");
    if (!app) throw new AuthorizePageError("unknown_app");
    const redirectUri = str(q.redirect_uri);
    if (!redirectUri || !strings(app.redirectUris).includes(redirectUri)) {
      throw new AuthorizePageError("bad_redirect");
    }
    // From here on, problems go back to the application.
    const state = str(q.state);
    const fail = (error: string, description: string): AuthorizeOutcome => ({
      kind: "redirect",
      url: withParams(redirectUri, {
        error,
        error_description: description,
        state,
        iss: this.issuer,
      }),
    });
    if (!app.enabled) throw new AuthorizePageError("app_disabled");
    if (q.response_type !== "code")
      return fail("unsupported_response_type", "Only response_type=code is supported");
    const scopes = (str(q.scope) ?? "").split(" ").filter(Boolean);
    if (!scopes.includes("openid")) return fail("invalid_scope", "The openid scope is required");
    const granted = scopes.filter((s) => (OIDC_SCOPES as readonly string[]).includes(s));
    const challenge = str(q.code_challenge);
    if (!challenge || !PKCE.test(challenge) || q.code_challenge_method !== "S256") {
      return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
    }
    const nonce = str(q.nonce);
    if (nonce && nonce.length > 255) return fail("invalid_request", "nonce is too long");

    if (!principal || principal.kind !== "user") {
      if (q.prompt === "none") return fail("login_required", "The person is not signed in");
      return {
        kind: "sign_in",
        returnTo: `/api/oidc/authorize?${rawQuery}`,
        loginHint: str(q.login_hint) ?? null,
      };
    }
    if (principal.tenantId !== app.tenantId) throw new AuthorizePageError("other_organisation");

    const allowed = app.allowedRoleIds === null ? null : strings(app.allowedRoleIds);
    if (allowed) {
      const has = await this.database.db.roleAssignment.count({
        where: {
          tenantId: app.tenantId,
          identityId: principal.identityId,
          roleId: { in: allowed },
        },
      });
      if (has === 0) {
        await this.audit.record({
          tenantId: app.tenantId,
          action: "auth.app_sign_in",
          outcome: "denied",
          actor: { id: principal.identityId, label: principal.email },
          target: { type: "application", id: app.id, label: app.name },
          meta,
          metadata: { reason: "not_assigned" },
        });
        return fail("access_denied", "You are not allowed to use this application");
      }
    }

    const session = await this.database.db.session.findUniqueOrThrow({
      where: { id: principal.sessionId, tenantId: principal.tenantId },
    });
    const code = randomBytes(32).toString("base64url");
    await this.database.db.oAuthAuthorizationCode.create({
      data: {
        tenantId: app.tenantId,
        applicationId: app.id,
        identityId: principal.identityId,
        sessionId: principal.sessionId,
        codeHash: hashToken(code),
        redirectUri,
        scope: granted.join(" "),
        nonce: nonce ?? null,
        codeChallenge: challenge,
        authTime: session.createdAt,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    await this.audit.record({
      tenantId: app.tenantId,
      action: "auth.app_sign_in",
      outcome: "success",
      actor: { id: principal.identityId, label: principal.email },
      target: { type: "application", id: app.id, label: app.name },
      meta,
      metadata: { scope: granted.join(" ") },
    });
    return { kind: "redirect", url: withParams(redirectUri, { code, state, iss: this.issuer }) };
  }

  // ───────────── Token endpoint ─────────────

  /** Client authentication: HTTP Basic or form fields; public clients send only client_id. */
  private async client(authorization: string | undefined, body: Record<string, unknown>) {
    let clientId = str(body.client_id);
    let secret = str(body.client_secret);
    const basic = /^Basic ([A-Za-z0-9+/=]+)$/.exec(authorization ?? "");
    if (basic) {
      const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx < 0) throw new OAuthError("invalid_client", "Malformed client credentials", 401);
      // RFC 6749 §2.3.1: both parts are form-urlencoded.
      clientId = decodeURIComponent(decoded.slice(0, idx).replace(/\+/g, " "));
      secret = decodeURIComponent(decoded.slice(idx + 1).replace(/\+/g, " "));
    }
    const app = clientId ? await this.apps.byClientId(clientId) : null;
    if (!app || !app.enabled)
      throw new OAuthError("invalid_client", "Unknown or disabled client", 401);
    if (app.type === "web") {
      if (!secret || !this.apps.secretMatches(app, secret)) {
        throw new OAuthError("invalid_client", "Client authentication failed", 401);
      }
    } else if (secret) {
      throw new OAuthError(
        "invalid_client",
        "This client is public and must not send a secret",
        401,
      );
    }
    return app;
  }

  async token(authorization: string | undefined, body: Record<string, unknown>) {
    const app = await this.client(authorization, body);
    if (body.grant_type !== "authorization_code") {
      throw new OAuthError("unsupported_grant_type", "Only authorization_code is supported");
    }
    const code = str(body.code);
    const verifier = str(body.code_verifier);
    const redirectUri = str(body.redirect_uri);
    if (!code || !verifier || !redirectUri) {
      throw new OAuthError("invalid_request", "code, code_verifier and redirect_uri are required");
    }
    const tenantId = app.tenantId;
    const row = await this.database.db.oAuthAuthorizationCode.findUnique({
      where: { codeHash: hashToken(code), tenantId },
    });
    const invalid = () =>
      new OAuthError("invalid_grant", "The code is invalid, expired or already used");
    if (!row || row.applicationId !== app.id || row.usedAt || row.expiresAt <= new Date())
      throw invalid();
    if (row.redirectUri !== redirectUri) throw invalid();
    if (!PKCE.test(verifier) || s256(verifier) !== row.codeChallenge) {
      throw new OAuthError("invalid_grant", "PKCE verification failed");
    }
    // One use: a replayed code loses the race here.
    const claimed = await this.database.db.oAuthAuthorizationCode.updateMany({
      where: { id: row.id, tenantId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid();

    const session = await this.database.db.session.findUnique({
      where: { id: row.sessionId, tenantId },
    });
    const identity = await this.database.db.identity.findUnique({
      where: { id: row.identityId, tenantId },
    });
    const now = new Date();
    if (
      !identity ||
      identity.status !== "active" ||
      !session ||
      session.revokedAt ||
      session.expiresAt <= now
    ) {
      throw new OAuthError("invalid_grant", "The person's session has ended");
    }
    await this.database.db.oAuthApplication.updateMany({
      where: { id: app.id, tenantId },
      data: { lastUsedAt: now },
    });

    const scopes = row.scope.split(" ");
    const claims = await this.claimsFor(tenantId, identity.id, scopes);
    const { kid, privateKey } = await this.keys.current();
    const iat = Math.floor(now.getTime() / 1000);
    const idToken = await new SignJWT({
      ...claims,
      auth_time: Math.floor(row.authTime.getTime() / 1000),
      ...(row.nonce ? { nonce: row.nonce } : {}),
      sid: row.sessionId,
      azp: app.clientId,
    })
      .setProtectedHeader({ alg: SIGNING_ALG, kid, typ: "JWT" })
      .setIssuer(this.issuer)
      .setSubject(identity.id)
      .setAudience(app.clientId)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ID_TOKEN_TTL_S)
      .sign(privateKey);
    // RFC 9068 access token, for this provider's userinfo endpoint.
    const accessToken = await new SignJWT({
      client_id: app.clientId,
      scope: row.scope,
      tid: tenantId,
      sid: row.sessionId,
    })
      .setProtectedHeader({ alg: SIGNING_ALG, kid, typ: "at+jwt" })
      .setIssuer(this.issuer)
      .setSubject(identity.id)
      .setAudience(`${this.issuer}/userinfo`)
      .setJti(randomUUID())
      .setIssuedAt(iat)
      .setExpirationTime(iat + ACCESS_TOKEN_TTL_S)
      .sign(privateKey);
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      id_token: idToken,
      scope: row.scope,
    };
  }

  private async claimsFor(tenantId: string, identityId: string, scopes: string[]) {
    const identity = await this.database.db.identity.findUniqueOrThrow({
      where: { id: identityId, tenantId },
    });
    const out: Record<string, unknown> = { tid: tenantId };
    if (scopes.includes("email")) {
      // Identities belong to the organisation's verified domains.
      out.email = identity.email;
      out.email_verified = true;
    }
    if (scopes.includes("profile")) {
      out.name = identity.displayName;
      out.preferred_username = identity.email;
    }
    if (scopes.includes("roles")) {
      const assignments = await this.database.db.roleAssignment.findMany({
        where: { tenantId, identityId },
        select: { role: { select: { key: true } } },
      });
      out.roles = assignments.map((a) => a.role.key).sort();
    }
    return out;
  }

  // ───────────── Userinfo ─────────────

  private async verify(token: string, audience: string | null, ignoreExpiry = false) {
    const jwks = createLocalJWKSet({ keys: await this.keys.publicKeys() });
    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      issuer: this.issuer,
      algorithms: [SIGNING_ALG],
      ...(audience ? { audience } : {}),
      ...(ignoreExpiry ? { currentDate: new Date(0) } : {}),
    });
    return { payload, typ: protectedHeader.typ };
  }

  async userinfo(authorization: string | undefined) {
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization ?? "");
    if (!match) throw new OAuthError("invalid_token", "A bearer access token is required", 401);
    let payload;
    try {
      const v = await this.verify(match[1]!, `${this.issuer}/userinfo`);
      if (v.typ !== "at+jwt") throw new Error("not an access token");
      payload = v.payload;
    } catch {
      throw new OAuthError("invalid_token", "The access token is invalid or expired", 401);
    }
    const tenantId = str(payload.tid);
    const sub = str(payload.sub);
    const identity =
      tenantId && sub
        ? await this.database.db.identity.findUnique({ where: { id: sub, tenantId } })
        : null;
    if (!identity || identity.status !== "active") {
      throw new OAuthError("invalid_token", "The person is no longer active", 401);
    }
    return {
      sub,
      ...(await this.claimsFor(tenantId!, sub!, (str(payload.scope) ?? "").split(" "))),
    };
  }

  // ───────────── RP-initiated logout ─────────────

  /**
   * Ends the person's Neural Frontier session when the application proves who it is signing
   * out (a valid id_token_hint for the same person). Without one, nothing is ended, so a link
   * on some page can't sign people out.
   */
  async endSession(
    q: Record<string, unknown>,
    principal: Principal | null,
    meta: RequestMeta,
  ): Promise<{ redirect: string; endedSession: boolean }> {
    const fallback = new URL("/sign-in?signedOut=1", this.config.publicUrl).toString();
    const hint = str(q.id_token_hint);
    let app: OAuthApplication | null = null;
    let sub: string | undefined;
    if (hint) {
      try {
        const kid = decodeProtectedHeader(hint).kid;
        if (!kid) throw new Error("no kid");
        const { payload } = await this.verify(hint, null, true);
        sub = str(payload.sub);
        const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
        app = await this.apps.byClientId(str(aud) ?? "");
      } catch {
        app = null;
      }
    }
    if (!app) app = await this.apps.byClientId(str(q.client_id) ?? "");
    const target = str(q.post_logout_redirect_uri);
    const redirect =
      app && target && strings(app.postLogoutRedirectUris).includes(target)
        ? withParams(target, { state: str(q.state) })
        : fallback;

    let endedSession = false;
    if (principal && sub && principal.identityId === sub && app?.tenantId === principal.tenantId) {
      await this.sessions.revoke(principal.tenantId, principal.sessionId);
      endedSession = true;
      await this.audit.record({
        tenantId: principal.tenantId,
        action: "auth.sign_out",
        outcome: "success",
        actor: { id: principal.identityId, label: principal.email },
        meta,
        metadata: { via: "application", application: app.name },
      });
    }
    return { redirect, endedSession };
  }
}
