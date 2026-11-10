import { z } from "zod";

/**
 * Built-in sign-in (Phase 3a): Neural Frontier's own accounts — password, authenticator-app
 * second factor, recovery codes and one-time setup/reset links. No external product involved.
 */

export const PASSWORD_MAX_LENGTH = 256;
export const MIN_PASSWORD_LENGTH_FLOOR = 10;
export const DEFAULT_MIN_PASSWORD_LENGTH = 12;

/** Passwords people pick first. Checked case-insensitively, after removing digits/symbols at the end. */
const COMMON = new Set(
  (
    "password passw0rd password1 qwerty qwertyuiop asdfghjkl zxcvbnm letmein welcome " +
    "admin administrator iloveyou monkey dragon football baseball sunshine princess " +
    "shadow master superman batman trustno1 changeme default secret login abc123 " +
    "1q2w3e4r 1qaz2wsx qazwsx starwars whatever freedom computer internet " +
    "neuralfrontier neural frontier"
  ).split(" "),
);

export interface PasswordContext {
  minLength: number;
  email?: string | null;
  displayName?: string | null;
}

/**
 * Plain-language problems with a proposed password (empty = acceptable). Shared by the browser
 * (live checklist) and the API (authoritative). Length matters most; no composition rules.
 */
export function passwordProblems(password: string, ctx: PasswordContext): string[] {
  const problems: string[] = [];
  const chars = [...password];
  if (chars.length < ctx.minLength) problems.push(`Use at least ${ctx.minLength} characters`);
  if (chars.length > PASSWORD_MAX_LENGTH)
    problems.push(`Use at most ${PASSWORD_MAX_LENGTH} characters`);
  const lower = password.toLowerCase();
  const stem = lower.replace(/[\d\W_]+$/u, "");
  if (COMMON.has(lower) || COMMON.has(stem)) problems.push("Avoid commonly used passwords");
  if (new Set(chars).size <= 3 && chars.length > 0)
    problems.push("Use more than a few different characters");
  if (/^(.)\1+$/u.test(password) || /^(?:0123456789|1234567890|abcdefghij)/.test(lower))
    problems.push("Avoid sequences and repeated characters");
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local))
    problems.push("Don't include your email address");
  return [...new Set(problems)];
}

// ---------- Tenant sign-in policy ----------

export const TwoFactorPolicySchema = z.enum(["optional", "required"]);
export type TwoFactorPolicy = z.infer<typeof TwoFactorPolicySchema>;

export const SignInPolicySchema = z.object({
  /** People can sign in with a Neural Frontier password (in addition to single sign-on). */
  passwordSignIn: z.boolean(),
  /** For password sign-ins: `required` makes everyone set up an authenticator app. */
  twoFactor: TwoFactorPolicySchema,
  minPasswordLength: z.number().int(),
  version: z.number().int(),
  updatedAt: z.iso.datetime().nullable(),
});
export type SignInPolicy = z.infer<typeof SignInPolicySchema>;

export const UpdateSignInPolicySchema = z.object({
  passwordSignIn: z.boolean(),
  twoFactor: TwoFactorPolicySchema,
  minPasswordLength: z.number().int().min(MIN_PASSWORD_LENGTH_FLOOR).max(64),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(500),
});
export type UpdateSignInPolicy = z.infer<typeof UpdateSignInPolicySchema>;

// ---------- Sign-in flow (public) ----------

export const EmailSchema = z.string().trim().toLowerCase().max(320).pipe(z.email());

export const DiscoverSignInSchema = z.object({ email: EmailSchema });
/** Which ways to sign in are offered for an email. Decided by its domain, not by the account. */
export const DiscoverSignInResponseSchema = z.object({
  password: z.boolean(),
  sso: z.boolean(),
  /** "Forgot password?" by email is available (the organisation has email set up). */
  passwordReset: z.boolean(),
});
export type DiscoverSignInResponse = z.infer<typeof DiscoverSignInResponseSchema>;

export const PasswordSignInSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  returnTo: z.string().max(512).optional(),
});
export type PasswordSignIn = z.infer<typeof PasswordSignInSchema>;

export const TwoFactorSetupSchema = z.object({
  /** Base32 seed, for typing into an authenticator app by hand. */
  secret: z.string(),
  /** otpauth:// URI, rendered as a QR code. */
  otpauthUri: z.string(),
});
export type TwoFactorSetup = z.infer<typeof TwoFactorSetupSchema>;

export const SignInStepSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("signed_in"),
    redirectTo: z.string(),
    /** Shown once, right after a second factor was set up during sign-in. */
    recoveryCodes: z.array(z.string()).optional(),
  }),
  z.object({ status: z.literal("two_factor_required") }),
  z.object({ status: z.literal("two_factor_setup_required"), setup: TwoFactorSetupSchema }),
]);
export type SignInStep = z.infer<typeof SignInStepSchema>;

/** A 6-digit authenticator code or a recovery code (xxxxx-xxxxx). */
export const SecondFactorCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6)
    .max(32)
    .transform((v) => v.replace(/\s+/g, "")),
});

// ---------- Setup / reset links ----------

export const SignInLinkPurposeSchema = z.enum(["setup", "reset"]);
export type SignInLinkPurpose = z.infer<typeof SignInLinkPurposeSchema>;

export const CreateSignInLinkSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  /** Also email the link to the person (needs email delivery set up). */
  sendEmail: z.boolean().default(false),
});

export const IssuedSignInLinkSchema = z.object({
  purpose: SignInLinkPurposeSchema,
  /** Shown once. Share it with the person over a channel you trust. */
  url: z.string(),
  expiresAt: z.iso.datetime(),
  /** Where the link was emailed, when it was. */
  emailedTo: z.string().nullable(),
});
export type IssuedSignInLink = z.infer<typeof IssuedSignInLinkSchema>;

export const SignInLinkTokenSchema = z.string().regex(/^nfl_[A-Za-z0-9_-]{43}$/);

export const SignInLinkInfoSchema = z.object({
  purpose: SignInLinkPurposeSchema,
  email: z.string(),
  displayName: z.string(),
  tenantName: z.string(),
  expiresAt: z.iso.datetime(),
  minPasswordLength: z.number().int(),
});
export type SignInLinkInfo = z.infer<typeof SignInLinkInfoSchema>;

export const RedeemSignInLinkSchema = z.object({
  token: SignInLinkTokenSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

// ---------- My account → Security ----------

export const MySecuritySchema = z.object({
  email: z.string(),
  password: z.object({ set: z.boolean(), updatedAt: z.iso.datetime().nullable() }),
  twoFactor: z.object({
    enabled: z.boolean(),
    enabledAt: z.iso.datetime().nullable(),
    recoveryCodesRemaining: z.number().int(),
  }),
  /** Linked to an external single sign-on account. */
  sso: z.object({ linked: z.boolean(), issuer: z.string().nullable() }),
  /** How this session signed in: "local" or a single sign-on provider key. */
  signedInWith: z.string().nullable(),
  /** Whether setting a first password needs a fresh sign-in first. */
  recentSignIn: z.boolean(),
  policy: SignInPolicySchema.pick({
    passwordSignIn: true,
    twoFactor: true,
    minPasswordLength: true,
  }),
});
export type MySecurity = z.infer<typeof MySecuritySchema>;

export const ChangePasswordSchema = z.object({
  /** Required when a password is already set. */
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH).optional(),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type ChangePassword = z.infer<typeof ChangePasswordSchema>;

export const RecoveryCodesSchema = z.object({ recoveryCodes: z.array(z.string()) });
export type RecoveryCodes = z.infer<typeof RecoveryCodesSchema>;

// ---------- Administrators: an identity's sign-in methods ----------

export const IdentitySignInMethodsSchema = z.object({
  password: z.object({ set: z.boolean(), updatedAt: z.iso.datetime().nullable() }),
  twoFactor: z.object({ enabled: z.boolean(), enabledAt: z.iso.datetime().nullable() }),
  sso: z.object({ linked: z.boolean(), issuer: z.string().nullable() }),
  lockedUntil: z.iso.datetime().nullable(),
  failedAttempts: z.number().int(),
  pendingLink: z
    .object({ purpose: SignInLinkPurposeSchema, expiresAt: z.iso.datetime() })
    .nullable(),
  /** Sessions currently signed in. */
  activeSessions: z.number().int(),
  /** The organisation can email links. */
  emailAvailable: z.boolean(),
  /** False when the caller may not change this person's sign-in (more access than the caller). */
  manageable: z.boolean(),
});
export type IdentitySignInMethods = z.infer<typeof IdentitySignInMethodsSchema>;

export const AdminCredentialActionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
