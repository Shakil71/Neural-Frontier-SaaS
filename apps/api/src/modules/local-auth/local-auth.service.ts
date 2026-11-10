import { createHash, randomBytes, randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  DEFAULT_MIN_PASSWORD_LENGTH,
  type ChangePassword,
  type DiscoverSignInResponse,
  type IdentitySignInMethods,
  type IssuedSignInLink,
  type MySecurity,
  type Permission,
  type SignInLinkInfo,
  type SignInLinkPurpose,
  type SignInOptions,
  type SignInPolicy,
  type SignInReadiness,
  type TwoFactorSetup,
  type UpdateSignInPolicy,
  passwordProblems,
} from "@nf/contracts";
import type { LocalCredential } from "@nf/db";
import { AppError, Errors } from "../../common/errors.js";
import type { Principal, RequestMeta } from "../../common/principal.js";
import { seal, unseal } from "../../common/sealed.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { DatabaseService } from "../../infra/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { OidcService } from "../auth/oidc.service.js";
import { SessionService } from "../auth/session.service.js";
import { hashToken, safeReturnTo } from "../auth/tokens.js";
import { AuthorizationService } from "../authz/authorization.service.js";
import { EmailService } from "../email/email.service.js";
import { passwordResetEmail, signInLinkEmail } from "../email/templates.js";
import type { SecondFactorChallenge } from "./challenge.js";
import { dummyHash, hashPassword, needsRehash, verifyPassword } from "./password.js";
import { newTotpSecret, otpauthUri, verifyTotp } from "./totp.js";

const ISSUER = "Neural Frontier";
const MAX_FAILURES = 5;
const MAX_LOCK_MS = 15 * 60_000;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i
const PENDING_TOTP_MS = 15 * 60_000;
/** Setting a first password from an existing session needs a sign-in this recent. */
export const RECENT_SIGN_IN_MS = 15 * 60_000;
const LINK_TTL_MS: Record<SignInLinkPurpose, number> = {
  setup: 72 * 3_600_000,
  reset: 24 * 3_600_000,
};

/** Who issued an action: a signed-in person, or the system (break-glass command, self-service reset). */
export type Actor = Principal | { kind: "operator"; label: string };

/** At most one self-service reset email per person in this window. */
const RESET_REQUEST_INTERVAL_MS = 2 * 60_000;

/** "13 Nov 2026, 17:46 UTC": unambiguous for any reader, wherever they are. */
function formatExpiry(d: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d)} UTC`;
}

const totpContext = (tenantId: string, identityId: string) => `totp:${tenantId}:${identityId}`;

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function newRecoveryCode(): string {
  const pick = () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  const part = () => Array.from({ length: 5 }, pick).join("");
  return `${part()}-${part()}`;
}

/** Bound to the identity, so equal codes of two people never collide or cross over. */
function recoveryHash(identityId: string, code: string): Uint8Array<ArrayBuffer> {
  const normal = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return new Uint8Array(createHash("sha256").update(`${identityId}:${normal}`).digest());
}

/** 1 min after the 5th failure, doubling each time, at most 15 min. */
function lockDuration(failures: number): number {
  return Math.min(MAX_LOCK_MS, 60_000 * 2 ** Math.max(0, failures - MAX_FAILURES));
}

export type PasswordSignInOutcome =
  | { kind: "session"; tenantId: string; identityId: string; returnTo: string }
  | { kind: "challenge"; challenge: SecondFactorChallenge; setup: TwoFactorSetup | null };

@Injectable()
export class LocalAuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly authz: AuthorizationService,
    private readonly oidc: OidcService,
    private readonly email: EmailService,
  ) {}

  // ───────────────────────── Policy ─────────────────────────

  async policy(tenantId: string): Promise<SignInPolicy> {
    const row = await this.database.db.tenantSignInPolicy.findUnique({ where: { tenantId } });
    return {
      passwordSignIn: row?.passwordSignIn ?? true,
      twoFactor: row?.twoFactor === "required" ? "required" : "optional",
      minPasswordLength: row?.minPasswordLength ?? DEFAULT_MIN_PASSWORD_LENGTH,
      version: row?.version ?? 0,
      updatedAt: iso(row?.updatedAt),
    };
  }

  /** Public sign-in screen options. */
  options(): SignInOptions {
    return { sharedSso: this.oidc.configured };
  }

  /** How many people could still sign in if the deployment-wide provider went away. */
  async readiness(tenantId: string): Promise<SignInReadiness> {
    const db = this.database.db;
    const active = { tenantId, status: "active" as const };
    const ownerRole = await db.role.findUnique({
      where: { tenantId_key: { tenantId, key: "owner" }, tenantId },
      select: { id: true },
    });
    const ownerFilter = ownerRole
      ? { roleAssignments: { some: { roleId: ownerRole.id } } }
      : { id: "__none__" };
    const [people, withPassword, withTwoFactor, owners, ownersWithPassword, own] =
      await Promise.all([
        db.identity.count({ where: active }),
        db.identity.count({
          where: { ...active, localCredential: { passwordHash: { not: null } } },
        }),
        db.identity.count({
          where: { ...active, localCredential: { totpEnabledAt: { not: null } } },
        }),
        db.identity.count({ where: { ...active, ...ownerFilter } }),
        db.identity.count({
          where: { ...active, ...ownerFilter, localCredential: { passwordHash: { not: null } } },
        }),
        db.tenantIdentityProvider.findUnique({ where: { tenantId }, select: { id: true } }),
      ]);
    return {
      people,
      withPassword,
      withTwoFactor,
      owners,
      ownersWithPassword,
      sharedSsoConfigured: this.oidc.configured,
      ownProvider: own !== null,
    };
  }

  async updatePolicy(actor: Principal, input: UpdateSignInPolicy, meta: RequestMeta) {
    const tenantId = actor.tenantId;
    const before = await this.policy(tenantId);
    if (before.version !== input.version) {
      throw Errors.conflict("The sign-in policy was changed by someone else. Reload and retry.");
    }
    const data = {
      passwordSignIn: input.passwordSignIn,
      twoFactor: input.twoFactor,
      minPasswordLength: input.minPasswordLength,
    };
    await this.database.db.$transaction(async (tx) => {
      const existing = await tx.tenantSignInPolicy.findUnique({ where: { tenantId } });
      if (existing) {
        const res = await tx.tenantSignInPolicy.updateMany({
          where: { tenantId, version: input.version },
          data: { ...data, version: { increment: 1 } },
        });
        if (res.count !== 1)
          throw Errors.conflict("The sign-in policy was changed by someone else.");
      } else {
        await tx.tenantSignInPolicy.create({ data: { tenantId, ...data, version: 1 } });
      }
      await this.audit.record(
        {
          tenantId,
          action: "tenant.sign_in_policy_changed",
          outcome: "success",
          actor: { id: actor.identityId, label: actor.email },
          meta,
          metadata: {
            reason: input.reason,
            before: {
              passwordSignIn: before.passwordSignIn,
              twoFactor: before.twoFactor,
              minPasswordLength: before.minPasswordLength,
            },
            after: data,
          },
        },
        tx,
      );
    });
    return this.policy(tenantId);
  }

  /** Why password sign-in is refused for a tenant, or null when it is allowed. */
  private async passwordRefusal(tenantId: string): Promise<string | null> {
    const policy = await this.policy(tenantId);
    if (!policy.passwordSignIn) {
      return "Your organisation signs in through its identity provider only. Use single sign-on.";
    }
    const idp = await this.database.db.tenantIdentityProvider.findUnique({
      where: { tenantId },
      select: { enforcement: true },
    });
    if (idp?.enforcement === "required") {
      return "Your organisation requires its own identity provider. Use single sign-on.";
    }
    return null;
  }

  // ───────────────────────── Sign-in ─────────────────────────

  /** Offered methods depend on the email's domain only, never on whether the account exists. */
  async discover(email: string): Promise<DiscoverSignInResponse> {
    const domain = email.split("@")[1] ?? "";
    // Cross-tenant by definition: the domain selects the tenant.
    const td = await this.database.system.tenantDomain.findUnique({
      where: { domain },
      include: { tenant: true },
    });
    const password =
      !!td?.verifiedAt &&
      td.tenant.status === "active" &&
      (await this.passwordRefusal(td.tenantId)) === null;
    return {
      password,
      sso: (await this.oidc.chooseProvider(email)) !== null,
      passwordReset: td && password ? await this.email.available(td.tenantId) : false,
    };
  }

  private invalid(): AppError {
    return new AppError("unauthenticated", 401, "Incorrect email or password.");
  }

  private locked(until: Date): AppError {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return new AppError(
      "rate_limited",
      429,
      `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask an administrator to unlock your account.`,
    );
  }

  /** Records a failed attempt; locks the account after MAX_FAILURES in a row. */
  private async recordFailure(
    cred: LocalCredential,
    email: string,
    meta: RequestMeta,
    reason: string,
  ): Promise<void> {
    const { tenantId, identityId } = cred;
    await this.database.db.localCredential.update({
      where: { id: cred.id, tenantId },
      data: { failedAttempts: { increment: 1 } },
    });
    const now = await this.database.db.localCredential.findUniqueOrThrow({
      where: { id: cred.id, tenantId },
    });
    await this.audit.record({
      tenantId,
      action: "auth.sign_in_failed",
      outcome: "failure",
      actor: { id: identityId, label: email },
      meta,
      metadata: { reason, method: "password", failedAttempts: now.failedAttempts },
    });
    if (now.failedAttempts >= MAX_FAILURES) {
      const until = new Date(Date.now() + lockDuration(now.failedAttempts));
      await this.database.db.localCredential.update({
        where: { id: cred.id, tenantId },
        data: { lockedUntil: until },
      });
      await this.audit.record({
        tenantId,
        action: "auth.account_locked",
        outcome: "failure",
        actor: { id: null, label: "system:sign-in" },
        target: { type: "identity", id: identityId, label: email },
        meta,
        metadata: { until: until.toISOString(), failedAttempts: now.failedAttempts },
      });
    }
  }

  async signInWithPassword(
    input: { email: string; password: string; returnTo?: string | undefined },
    meta: RequestMeta,
  ): Promise<PasswordSignInOutcome> {
    const domain = input.email.split("@")[1] ?? "";
    const td = await this.database.system.tenantDomain.findUnique({
      where: { domain },
      include: { tenant: true },
    });
    const tenantId = td?.verifiedAt ? td.tenantId : null;
    const identity = tenantId
      ? await this.database.db.identity.findUnique({
          where: { tenantId_email: { tenantId, email: input.email }, tenantId },
        })
      : null;
    const cred =
      identity && tenantId
        ? await this.database.db.localCredential.findUnique({
            where: { tenantId_identityId: { tenantId, identityId: identity.id }, tenantId },
          })
        : null;

    if (tenantId) {
      const refused = await this.passwordRefusal(tenantId);
      if (refused) throw Errors.forbidden(refused);
    }
    if (cred?.lockedUntil && cred.lockedUntil > new Date()) throw this.locked(cred.lockedUntil);

    // Always pay for one scrypt, so a missing account costs the same time as a wrong password.
    const ok = await verifyPassword(input.password, cred?.passwordHash ?? (await dummyHash()));
    if (!ok || !cred?.passwordHash || !identity || !tenantId || !td) {
      if (cred && identity) await this.recordFailure(cred, input.email, meta, "wrong_password");
      else
        await this.audit.record({
          tenantId,
          action: "auth.sign_in_failed",
          outcome: "failure",
          actor: { id: null, label: input.email },
          meta,
          metadata: { reason: identity ? "no_password" : "unknown_account", method: "password" },
        });
      throw this.invalid();
    }

    if (td.tenant.status !== "active")
      throw Errors.forbidden("Your organisation's access is suspended.");
    if (identity.status !== "active") {
      throw Errors.forbidden("Your account is suspended. Contact your administrator.");
    }

    // Password is right: start from a clean slate, and upgrade an old hash while we have the password.
    await this.database.db.localCredential.update({
      where: { id: cred.id, tenantId },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        ...(needsRehash(cred.passwordHash)
          ? { passwordHash: await hashPassword(input.password) }
          : {}),
      },
    });

    const returnTo = safeReturnTo(input.returnTo);
    const base = { tenantId, identityId: identity.id, returnTo, credentialVersion: cred.version };
    if (cred.totpEnabledAt && cred.totpSecretSealed) {
      return { kind: "challenge", challenge: { ...base, stage: "verify" }, setup: null };
    }
    const policy = await this.policy(tenantId);
    if (policy.twoFactor === "required") {
      this.requireDataKey();
      const secret = newTotpSecret();
      return {
        kind: "challenge",
        challenge: { ...base, stage: "enroll", pendingSecret: secret },
        setup: { secret, otpauthUri: otpauthUri(secret, ISSUER, identity.email) },
      };
    }
    return { kind: "session", tenantId, identityId: identity.id, returnTo };
  }

  /** Completes a two-factor challenge. Returns recovery codes when the factor was just set up. */
  async completeSecondFactor(
    challenge: SecondFactorChallenge,
    code: string,
    meta: RequestMeta,
  ): Promise<{ recoveryCodes: string[] | null }> {
    const { tenantId, identityId } = challenge;
    const identity = await this.database.db.identity.findUnique({
      where: { id: identityId, tenantId },
    });
    const cred = await this.database.db.localCredential.findUnique({
      where: { tenantId_identityId: { tenantId, identityId }, tenantId },
    });
    if (
      !identity ||
      identity.status !== "active" ||
      !cred ||
      cred.version !== challenge.credentialVersion
    ) {
      throw Errors.unauthenticated("This sign-in is no longer valid. Start again.");
    }
    if (cred.lockedUntil && cred.lockedUntil > new Date()) throw this.locked(cred.lockedUntil);

    if (challenge.stage === "enroll") {
      const step = verifyTotp(challenge.pendingSecret!, code);
      if (step === null) {
        await this.recordFailure(cred, identity.email, meta, "wrong_two_factor_code");
        throw Errors.badRequest(
          "That code didn't match. Check the time on your phone and try again.",
        );
      }
      const recoveryCodes = await this.activateTotp(
        cred,
        challenge.pendingSecret!,
        step,
        { id: identityId, label: identity.email },
        meta,
      );
      return { recoveryCodes };
    }

    const result = await this.checkSecondFactor(cred, code);
    if (!result.ok) {
      await this.recordFailure(cred, identity.email, meta, "wrong_two_factor_code");
      throw Errors.badRequest("That code didn't work. Try the newest code from your app.");
    }
    await this.afterSecondFactor(cred, result, { id: identityId, label: identity.email }, meta);
    return { recoveryCodes: null };
  }

  /** Opens the session for a completed sign-in and records it. */
  async startSession(
    tenantId: string,
    identityId: string,
    meta: RequestMeta,
    twoFactor: boolean,
  ): Promise<string> {
    const identity = await this.database.db.identity.update({
      where: { id: identityId, tenantId },
      data: { lastSignInAt: new Date() },
    });
    await this.database.db.localCredential.updateMany({
      where: { tenantId, identityId },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    const { token } = await this.sessions.create(tenantId, identityId, meta, {
      provider: "local",
      idToken: null,
    });
    await this.audit.record({
      tenantId,
      action: "auth.sign_in",
      outcome: "success",
      actor: { id: identityId, label: identity.email },
      meta,
      metadata: { method: "password", twoFactor },
    });
    return token;
  }

  // ───────────────────────── Second factor internals ─────────────────────────

  private requireDataKey(): Buffer {
    if (!this.config.dataKey) {
      throw Errors.unavailable("Two-factor sign-in needs NF_DATA_KEY to be configured.");
    }
    return this.config.dataKey;
  }

  private secretOf(cred: LocalCredential): string | null {
    if (!cred.totpSecretSealed || !cred.totpEnabledAt) return null;
    return unseal(
      this.requireDataKey(),
      new Uint8Array(cred.totpSecretSealed),
      totpContext(cred.tenantId, cred.identityId),
    );
  }

  /** A 6-digit authenticator code, or an unused recovery code. */
  private async checkSecondFactor(
    cred: LocalCredential,
    code: string,
  ): Promise<{ ok: false } | { ok: true; step: number } | { ok: true; recoveryCodeId: string }> {
    if (/^\d{6}$/.test(code)) {
      const secret = this.secretOf(cred);
      const step = secret ? verifyTotp(secret, code, { notAfterStep: cred.totpLastStep }) : null;
      return step === null ? { ok: false } : { ok: true, step };
    }
    const row = await this.database.db.recoveryCode.findFirst({
      where: {
        tenantId: cred.tenantId,
        identityId: cred.identityId,
        codeHash: recoveryHash(cred.identityId, code),
        usedAt: null,
      },
    });
    return row ? { ok: true, recoveryCodeId: row.id } : { ok: false };
  }

  /** Consumes what was used: the TOTP step (no replay) or the recovery code (one use). */
  private async afterSecondFactor(
    cred: LocalCredential,
    result: { ok: true; step: number } | { ok: true; recoveryCodeId: string },
    actor: { id: string; label: string },
    meta: RequestMeta,
  ) {
    const { tenantId } = cred;
    if ("step" in result) {
      // Conditional update: two concurrent requests with the same code cannot both pass.
      const res = await this.database.db.localCredential.updateMany({
        where: {
          tenantId,
          id: cred.id,
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: result.step } }],
        },
        data: { totpLastStep: result.step },
      });
      if (res.count !== 1)
        throw Errors.badRequest("That code was already used. Wait for the next one.");
      return;
    }
    const used = await this.database.db.recoveryCode.updateMany({
      where: { tenantId, id: result.recoveryCodeId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) throw Errors.badRequest("That recovery code was already used.");
    const remaining = await this.database.db.recoveryCode.count({
      where: { tenantId, identityId: cred.identityId, usedAt: null },
    });
    await this.audit.record({
      tenantId,
      action: "auth.recovery_code_used",
      outcome: "success",
      actor,
      meta,
      metadata: { remaining },
    });
  }

  private async replaceRecoveryCodes(
    tx: Pick<DatabaseService["db"], "recoveryCode">,
    tenantId: string,
    identityId: string,
  ): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await tx.recoveryCode.deleteMany({ where: { tenantId, identityId } });
    await tx.recoveryCode.createMany({
      data: codes.map((c) => ({ tenantId, identityId, codeHash: recoveryHash(identityId, c) })),
    });
    return codes;
  }

  private async activateTotp(
    cred: LocalCredential,
    secret: string,
    step: number,
    actor: { id: string; label: string },
    meta: RequestMeta,
  ): Promise<string[]> {
    const { tenantId, identityId } = cred;
    const sealed = seal(this.requireDataKey(), secret, totpContext(tenantId, identityId));
    return this.database.db.$transaction(async (tx) => {
      const res = await tx.localCredential.updateMany({
        where: { tenantId, id: cred.id, version: cred.version },
        data: {
          totpSecretSealed: sealed,
          totpEnabledAt: new Date(),
          totpLastStep: step,
          totpPendingSealed: null,
          totpPendingAt: null,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw Errors.conflict("Your sign-in settings changed. Start again.");
      const codes = await this.replaceRecoveryCodes(tx, tenantId, identityId);
      await this.audit.record(
        { tenantId, action: "auth.two_factor_enabled", outcome: "success", actor, meta },
        tx,
      );
      return codes;
    });
  }

  // ───────────────────────── My account → Security ─────────────────────────

  private async credentialOf(tenantId: string, identityId: string) {
    return this.database.db.localCredential.findUnique({
      where: { tenantId_identityId: { tenantId, identityId }, tenantId },
    });
  }

  private async sessionOf(p: Principal) {
    return this.database.db.session.findUnique({
      where: { id: p.sessionId, tenantId: p.tenantId },
    });
  }

  async mySecurity(p: Principal): Promise<MySecurity> {
    const [cred, identity, session, policy] = await Promise.all([
      this.credentialOf(p.tenantId, p.identityId),
      this.database.db.identity.findUniqueOrThrow({
        where: { id: p.identityId, tenantId: p.tenantId },
      }),
      this.sessionOf(p),
      this.policy(p.tenantId),
    ]);
    const remaining = cred?.totpEnabledAt
      ? await this.database.db.recoveryCode.count({
          where: { tenantId: p.tenantId, identityId: p.identityId, usedAt: null },
        })
      : 0;
    return {
      email: identity.email,
      password: { set: !!cred?.passwordHash, updatedAt: iso(cred?.passwordUpdatedAt) },
      twoFactor: {
        enabled: !!cred?.totpEnabledAt,
        enabledAt: iso(cred?.totpEnabledAt),
        recoveryCodesRemaining: remaining,
      },
      sso: { linked: !!identity.oidcSubject, issuer: identity.oidcIssuer },
      signedInWith: session?.authProvider ?? null,
      recentSignIn: !!session && Date.now() - session.createdAt.getTime() < RECENT_SIGN_IN_MS,
      policy: {
        passwordSignIn: policy.passwordSignIn,
        twoFactor: policy.twoFactor,
        minPasswordLength: policy.minPasswordLength,
      },
    };
  }

  private async assertAcceptable(tenantId: string, password: string, identityId: string) {
    const [policy, identity] = await Promise.all([
      this.policy(tenantId),
      this.database.db.identity.findUniqueOrThrow({ where: { id: identityId, tenantId } }),
    ]);
    const problems = passwordProblems(password, {
      minLength: policy.minPasswordLength,
      email: identity.email,
      displayName: identity.displayName,
    });
    if (problems.length) {
      throw new AppError(
        "validation_failed",
        422,
        problems[0]!,
        problems.map((message) => ({ path: "password", message })),
      );
    }
  }

  async changePassword(p: Principal, input: ChangePassword, meta: RequestMeta) {
    const { tenantId, identityId } = p;
    const refused = await this.passwordRefusal(tenantId);
    if (refused) throw Errors.forbidden(refused);
    const cred = await this.credentialOf(tenantId, identityId);
    if (cred?.lockedUntil && cred.lockedUntil > new Date()) throw this.locked(cred.lockedUntil);

    if (cred?.passwordHash) {
      if (
        !input.currentPassword ||
        !(await verifyPassword(input.currentPassword, cred.passwordHash))
      ) {
        await this.recordFailure(cred, p.email, meta, "wrong_current_password");
        throw Errors.badRequest("Your current password is incorrect.");
      }
    } else {
      // No password yet: a stolen, long-lived session must not be able to add one.
      const session = await this.sessionOf(p);
      if (!session || Date.now() - session.createdAt.getTime() >= RECENT_SIGN_IN_MS) {
        throw Errors.forbidden("For your security, sign in again before setting a password.");
      }
    }
    await this.assertAcceptable(tenantId, input.newPassword, identityId);
    if (cred?.passwordHash && (await verifyPassword(input.newPassword, cred.passwordHash))) {
      throw Errors.badRequest("Choose a password different from your current one.");
    }
    const passwordHash = await hashPassword(input.newPassword);
    const first = !cred?.passwordHash;
    await this.database.db.$transaction(async (tx) => {
      if (cred) {
        await tx.localCredential.update({
          where: { id: cred.id, tenantId },
          data: {
            passwordHash,
            passwordUpdatedAt: new Date(),
            failedAttempts: 0,
            lockedUntil: null,
            version: { increment: 1 },
          },
        });
      } else {
        await tx.localCredential.create({
          data: { tenantId, identityId, passwordHash, passwordUpdatedAt: new Date() },
        });
      }
      // Every other session ends: whoever might know the old password is signed out.
      await tx.session.updateMany({
        where: { tenantId, identityId, revokedAt: null, id: { not: p.sessionId } },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          tenantId,
          action: first ? "auth.password_set" : "auth.password_changed",
          outcome: "success",
          actor: { id: identityId, label: p.email },
          meta,
          metadata: { via: "self_service" },
        },
        tx,
      );
    });
    return this.mySecurity(p);
  }

  async beginTwoFactorSetup(p: Principal): Promise<TwoFactorSetup> {
    const key = this.requireDataKey();
    const cred = await this.credentialOf(p.tenantId, p.identityId);
    if (!cred?.passwordHash) {
      throw Errors.conflict("Set a password first: two-factor protects password sign-ins.");
    }
    if (cred.totpEnabledAt) throw Errors.conflict("Two-factor is already on.");
    const secret = newTotpSecret();
    await this.database.db.localCredential.update({
      where: { id: cred.id, tenantId: p.tenantId },
      data: {
        totpPendingSealed: seal(key, secret, `${totpContext(p.tenantId, p.identityId)}:pending`),
        totpPendingAt: new Date(),
      },
    });
    return { secret, otpauthUri: otpauthUri(secret, ISSUER, p.email) };
  }

  async enableTwoFactor(p: Principal, code: string, meta: RequestMeta): Promise<string[]> {
    const key = this.requireDataKey();
    const cred = await this.credentialOf(p.tenantId, p.identityId);
    if (!cred?.totpPendingSealed || !cred.totpPendingAt) {
      throw Errors.conflict("Start the set-up again: no authenticator is waiting to be confirmed.");
    }
    if (Date.now() - cred.totpPendingAt.getTime() > PENDING_TOTP_MS) {
      throw Errors.conflict("The set-up expired. Start again to get a new QR code.");
    }
    const secret = unseal(
      key,
      new Uint8Array(cred.totpPendingSealed),
      `${totpContext(p.tenantId, p.identityId)}:pending`,
    );
    const step = verifyTotp(secret, code);
    if (step === null) {
      throw Errors.badRequest(
        "That code didn't match. Check the time on your phone and try again.",
      );
    }
    return this.activateTotp(cred, secret, step, { id: p.identityId, label: p.email }, meta);
  }

  /** Verifies a current second factor of the signed-in person (for sensitive changes). */
  private async requireOwnSecondFactor(p: Principal, code: string, meta: RequestMeta) {
    const cred = await this.credentialOf(p.tenantId, p.identityId);
    if (!cred?.totpEnabledAt) throw Errors.conflict("Two-factor is not on.");
    if (cred.lockedUntil && cred.lockedUntil > new Date()) throw this.locked(cred.lockedUntil);
    const result = await this.checkSecondFactor(cred, code);
    if (!result.ok) {
      await this.recordFailure(cred, p.email, meta, "wrong_two_factor_code");
      throw Errors.badRequest("That code didn't work. Try the newest code from your app.");
    }
    await this.afterSecondFactor(cred, result, { id: p.identityId, label: p.email }, meta);
    return cred;
  }

  async disableTwoFactor(p: Principal, code: string, meta: RequestMeta) {
    const policy = await this.policy(p.tenantId);
    if (policy.twoFactor === "required") {
      throw Errors.forbidden(
        "Your organisation requires two-factor sign-in, so it can't be turned off.",
      );
    }
    const cred = await this.requireOwnSecondFactor(p, code, meta);
    await this.clearTwoFactor(
      cred,
      { id: p.identityId, label: p.email },
      meta,
      "auth.two_factor_disabled",
      {},
    );
    return this.mySecurity(p);
  }

  async regenerateRecoveryCodes(p: Principal, code: string, meta: RequestMeta): Promise<string[]> {
    await this.requireOwnSecondFactor(p, code, meta);
    return this.database.db.$transaction(async (tx) => {
      const codes = await this.replaceRecoveryCodes(tx, p.tenantId, p.identityId);
      await this.audit.record(
        {
          tenantId: p.tenantId,
          action: "auth.recovery_codes_regenerated",
          outcome: "success",
          actor: { id: p.identityId, label: p.email },
          meta,
        },
        tx,
      );
      return codes;
    });
  }

  private async clearTwoFactor(
    cred: LocalCredential,
    actor: { id: string | null; label: string },
    meta: RequestMeta,
    action: "auth.two_factor_disabled" | "auth.two_factor_reset",
    metadata: Record<string, unknown>,
    target?: { type: string; id: string; label: string },
  ) {
    const { tenantId, identityId } = cred;
    await this.database.db.$transaction(async (tx) => {
      await tx.localCredential.update({
        where: { id: cred.id, tenantId },
        data: {
          totpSecretSealed: null,
          totpEnabledAt: null,
          totpPendingSealed: null,
          totpPendingAt: null,
          totpLastStep: null,
          version: { increment: 1 },
        },
      });
      await tx.recoveryCode.deleteMany({ where: { tenantId, identityId } });
      await this.audit.record(
        { tenantId, action, outcome: "success", actor, meta, metadata, target: target ?? null },
        tx,
      );
    });
  }

  // ───────────────────────── Administrators ─────────────────────────

  /**
   * Containment: you may only change the sign-in of someone whose access you fully hold.
   * Otherwise an administrator could reset an owner's password and become the owner.
   */
  private async manageable(actor: Principal, identityId: string): Promise<boolean> {
    if (actor.identityId === identityId) return false;
    const target = await this.authz.permissionsFor(actor.tenantId, identityId);
    return [...target].every((perm: Permission) => actor.permissions.has(perm));
  }

  private async targetIdentity(tenantId: string, identityId: string) {
    const identity = await this.database.db.identity.findUnique({
      where: { id: identityId, tenantId },
    });
    if (!identity) throw Errors.notFound("Identity");
    return identity;
  }

  private async assertManageable(actor: Actor, tenantId: string, identityId: string) {
    if (actor.kind === "operator") return;
    if (actor.identityId === identityId) {
      throw Errors.forbidden("Change your own sign-in from My account → Security.");
    }
    if (!(await this.manageable(actor, identityId))) {
      throw Errors.forbidden(
        "This person has access you don't have, so you can't change how they sign in.",
      );
    }
    void tenantId;
  }

  async signInMethods(actor: Principal, identityId: string): Promise<IdentitySignInMethods> {
    const { tenantId } = actor;
    const identity = await this.targetIdentity(tenantId, identityId);
    const [cred, link] = await Promise.all([
      this.credentialOf(tenantId, identityId),
      this.database.db.signInLink.findFirst({
        where: {
          tenantId,
          identityId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const locked = cred?.lockedUntil && cred.lockedUntil > new Date() ? cred.lockedUntil : null;
    return {
      password: { set: !!cred?.passwordHash, updatedAt: iso(cred?.passwordUpdatedAt) },
      twoFactor: { enabled: !!cred?.totpEnabledAt, enabledAt: iso(cred?.totpEnabledAt) },
      sso: { linked: !!identity.oidcSubject, issuer: identity.oidcIssuer },
      lockedUntil: iso(locked),
      failedAttempts: cred?.failedAttempts ?? 0,
      pendingLink: link
        ? {
            purpose: link.purpose === "reset" ? "reset" : "setup",
            expiresAt: link.expiresAt.toISOString(),
          }
        : null,
      manageable: await this.manageable(actor, identityId),
      activeSessions: await this.sessions.countActive(tenantId, identityId),
      emailAvailable: await this.email.available(tenantId),
    };
  }

  private actorRef(actor: Actor) {
    return actor.kind === "operator"
      ? { id: null, label: actor.label }
      : { id: actor.identityId, label: actor.email };
  }

  async createSignInLink(
    actor: Actor,
    tenantId: string,
    identityId: string,
    reason: string,
    meta: RequestMeta,
    opts: { sendEmail?: boolean; kind?: "admin" | "self_service" } = {},
  ): Promise<IssuedSignInLink> {
    const identity = await this.targetIdentity(tenantId, identityId);
    await this.assertManageable(actor, tenantId, identityId);
    if (identity.status !== "active") throw Errors.conflict("Reactivate this person first.");
    if (opts.sendEmail && !(await this.email.available(tenantId))) {
      throw Errors.conflict(
        "Email delivery isn't set up. Set it up in Organisation → Email delivery, or copy the link instead.",
      );
    }
    const refused = await this.passwordRefusal(tenantId);
    if (refused) {
      throw Errors.conflict(
        "Password sign-in is off for this organisation (sign-in policy or a required identity provider).",
      );
    }
    const cred = await this.credentialOf(tenantId, identityId);
    const purpose: SignInLinkPurpose = cred?.passwordHash ? "reset" : "setup";
    const token = `nfl_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + LINK_TTL_MS[purpose]);
    await this.database.db.$transaction(async (tx) => {
      // One live link per person: issuing a new one voids the previous.
      await tx.signInLink.updateMany({
        where: { tenantId, identityId, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const link = await tx.signInLink.create({
        data: {
          tenantId,
          identityId,
          tokenHash: hashToken(token),
          purpose,
          expiresAt,
          createdById: actor.kind === "operator" ? null : actor.identityId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          action: "auth.sign_in_link_created",
          outcome: "success",
          actor: this.actorRef(actor),
          target: { type: "identity", id: identityId, label: identity.email },
          meta,
          metadata: { purpose, reason, linkId: link.id, expiresAt: expiresAt.toISOString() },
        },
        tx,
      );
    });
    // The token travels in the fragment: browsers never send it to a server or in a Referer.
    const url = new URL(`/sign-in/setup#${token}`, this.config.publicUrl).toString();
    let emailedTo: string | null = null;
    if (opts.sendEmail) {
      const tenant = await this.database.system.tenant.findUniqueOrThrow({
        where: { id: tenantId },
      });
      const common = {
        tenantName: tenant.name,
        displayName: identity.displayName,
        url,
        expires: formatExpiry(expiresAt),
        purpose,
      };
      const mail =
        opts.kind === "self_service"
          ? passwordResetEmail(common)
          : signInLinkEmail({
              ...common,
              issuedBy: actor.kind === "operator" ? "Your administrator" : actor.displayName,
            });
      const queued = await this.email.queue(
        tenantId,
        identity.email,
        opts.kind === "self_service" ? "password_reset" : "sign_in_link",
        mail,
      );
      emailedTo = queued ? identity.email : null;
    }
    return { purpose, url, expiresAt: expiresAt.toISOString(), emailedTo };
  }

  /**
   * "Forgot password?": emails a reset (or set-up) link when the account exists and may sign in
   * with a password. The caller always gets the same answer, whether or not anything was sent.
   */
  async requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
    const address = email.trim().toLowerCase();
    const who = await this.findByEmail(address);
    if (!who) return;
    const { tenantId, identityId } = who;
    const identity = await this.database.db.identity.findUnique({
      where: { id: identityId, tenantId },
    });
    if (!identity || identity.status !== "active") return;
    if ((await this.passwordRefusal(tenantId)) || !(await this.email.available(tenantId))) return;
    // Rate limit per person: repeated requests can't flood an inbox or keep voiding links.
    const recent = await this.database.db.signInLink.count({
      where: {
        tenantId,
        identityId,
        createdAt: { gt: new Date(Date.now() - RESET_REQUEST_INTERVAL_MS) },
      },
    });
    if (recent > 0) return;
    await this.audit.record({
      tenantId,
      action: "auth.password_reset_requested",
      outcome: "success",
      actor: { id: null, label: address },
      target: { type: "identity", id: identityId, label: identity.email },
      meta,
    });
    await this.createSignInLink(
      { kind: "operator", label: "system:password-reset" },
      tenantId,
      identityId,
      "Requested from the sign-in page",
      meta,
      { sendEmail: true, kind: "self_service" },
    );
  }

  // ───────────────────────── Sessions ─────────────────────────

  async mySessions(p: Principal) {
    const rows = await this.sessions.listActive(p.tenantId, p.identityId);
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        signedInWith: s.authProvider,
        current: s.id === p.sessionId,
      })),
    };
  }

  async revokeMySession(p: Principal, sessionId: string, meta: RequestMeta) {
    if (sessionId === p.sessionId) {
      throw Errors.badRequest("To end this session, use Sign out.");
    }
    const res = await this.database.db.session.updateMany({
      where: { tenantId: p.tenantId, identityId: p.identityId, id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw Errors.notFound("Session");
    await this.audit.record({
      tenantId: p.tenantId,
      action: "auth.session_revoked",
      outcome: "success",
      actor: { id: p.identityId, label: p.email },
      meta,
      metadata: { sessionId },
    });
    return { revoked: 1 };
  }

  async revokeMyOtherSessions(p: Principal, meta: RequestMeta) {
    const revoked = await this.sessions.revokeFor(p.tenantId, p.identityId, p.sessionId);
    await this.audit.record({
      tenantId: p.tenantId,
      action: "auth.sessions_revoked",
      outcome: "success",
      actor: { id: p.identityId, label: p.email },
      meta,
      metadata: { revoked, scope: "other_sessions" },
    });
    return { revoked };
  }

  /** Administrators: sign someone out everywhere (e.g. a lost laptop). */
  async signOutEverywhere(actor: Principal, identityId: string, reason: string, meta: RequestMeta) {
    const { tenantId } = actor;
    const identity = await this.targetIdentity(tenantId, identityId);
    await this.assertManageable(actor, tenantId, identityId);
    const revoked = await this.sessions.revokeFor(tenantId, identityId);
    await this.audit.record({
      tenantId,
      action: "auth.sessions_revoked",
      outcome: "success",
      actor: { id: actor.identityId, label: actor.email },
      target: { type: "identity", id: identityId, label: identity.email },
      meta,
      metadata: { revoked, reason, scope: "all_sessions" },
    });
    return { revoked };
  }

  async resetTwoFactor(actor: Principal, identityId: string, reason: string, meta: RequestMeta) {
    const { tenantId } = actor;
    const identity = await this.targetIdentity(tenantId, identityId);
    await this.assertManageable(actor, tenantId, identityId);
    const cred = await this.credentialOf(tenantId, identityId);
    if (!cred?.totpEnabledAt) throw Errors.conflict("Two-factor is not on for this person.");
    await this.clearTwoFactor(
      cred,
      this.actorRef(actor),
      meta,
      "auth.two_factor_reset",
      { reason },
      { type: "identity", id: identityId, label: identity.email },
    );
    return this.signInMethods(actor, identityId);
  }

  async unlock(actor: Principal, identityId: string, reason: string, meta: RequestMeta) {
    const { tenantId } = actor;
    const identity = await this.targetIdentity(tenantId, identityId);
    await this.assertManageable(actor, tenantId, identityId);
    const cred = await this.credentialOf(tenantId, identityId);
    if (!cred || (!cred.lockedUntil && cred.failedAttempts === 0)) {
      throw Errors.conflict("This account isn't locked.");
    }
    await this.database.db.$transaction(async (tx) => {
      await tx.localCredential.update({
        where: { id: cred.id, tenantId },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      await this.audit.record(
        {
          tenantId,
          action: "auth.account_unlocked",
          outcome: "success",
          actor: this.actorRef(actor),
          target: { type: "identity", id: identityId, label: identity.email },
          meta,
          metadata: { reason },
        },
        tx,
      );
    });
    return this.signInMethods(actor, identityId);
  }

  // ───────────────────────── Setup / reset links (public) ─────────────────────────

  private async liveLink(token: string) {
    // Cross-tenant by definition: the token identifies the tenant.
    const link = await this.database.system.signInLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { identity: true, tenant: true },
    });
    if (
      !link ||
      link.usedAt ||
      link.revokedAt ||
      link.expiresAt <= new Date() ||
      link.identity.status !== "active" ||
      link.tenant.status !== "active"
    ) {
      throw new AppError(
        "not_found",
        404,
        "This link has expired or was already used. Ask your administrator for a new one.",
      );
    }
    return link;
  }

  async linkInfo(token: string): Promise<SignInLinkInfo> {
    const link = await this.liveLink(token);
    const policy = await this.policy(link.tenantId);
    return {
      purpose: link.purpose === "reset" ? "reset" : "setup",
      email: link.identity.email,
      displayName: link.identity.displayName,
      tenantName: link.tenant.name,
      expiresAt: link.expiresAt.toISOString(),
      minPasswordLength: policy.minPasswordLength,
    };
  }

  async redeemLink(token: string, password: string, meta: RequestMeta): Promise<{ email: string }> {
    const link = await this.liveLink(token);
    const { tenantId, identityId } = link;
    const refused = await this.passwordRefusal(tenantId);
    if (refused) throw Errors.forbidden(refused);
    await this.assertAcceptable(tenantId, password, identityId);
    const passwordHash = await hashPassword(password);
    const cred = await this.credentialOf(tenantId, identityId);
    const actor = { id: identityId, label: link.identity.email };

    await this.database.db.$transaction(async (tx) => {
      const claimed = await tx.signInLink.updateMany({
        where: { tenantId, id: link.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw Errors.conflict("This link was already used.");
      const data = {
        passwordHash,
        passwordUpdatedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      };
      if (cred) {
        await tx.localCredential.update({
          where: { id: cred.id, tenantId },
          data: { ...data, version: { increment: 1 } },
        });
      } else {
        await tx.localCredential.create({ data: { tenantId, identityId, ...data } });
      }
      // A reset means the old password may be known to someone else: end every session.
      await tx.session.updateMany({
        where: { tenantId, identityId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          tenantId,
          action: "auth.sign_in_link_used",
          outcome: "success",
          actor,
          meta,
          metadata: { purpose: link.purpose, linkId: link.id },
        },
        tx,
      );
      await this.audit.record(
        {
          tenantId,
          action: cred?.passwordHash ? "auth.password_changed" : "auth.password_set",
          outcome: "success",
          actor,
          meta,
          metadata: { via: `${link.purpose}_link` },
        },
        tx,
      );
    });
    return { email: link.identity.email };
  }

  /** Operator break-glass: resolves an email to its tenant and identity. */
  async findByEmail(email: string) {
    const domain = email.split("@")[1] ?? "";
    const td = await this.database.system.tenantDomain.findUnique({ where: { domain } });
    if (!td) return null;
    const identity = await this.database.db.identity.findUnique({
      where: { tenantId_email: { tenantId: td.tenantId, email }, tenantId: td.tenantId },
    });
    return identity ? { tenantId: td.tenantId, identityId: identity.id } : null;
  }
}
