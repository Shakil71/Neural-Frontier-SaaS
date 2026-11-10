"use client";

import { DiscoverSignInResponseSchema, SignInStepSchema, type TwoFactorSetup } from "@nf/contracts";
import {
  ArrowLeft,
  ArrowRight,
  Fingerprint,
  KeyRound,
  Loader2,
  Mail,
  MailCheck,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  AuthenticatorSetup,
  CodeInput,
  PasswordInput,
  RecoveryCodes,
} from "@/components/auth/auth-parts";
import { api, ApiRequestError } from "@/lib/api";

type Step =
  | { kind: "email" }
  | { kind: "password"; email: string; sso: boolean; passwordReset: boolean }
  | { kind: "reset_sent"; email: string }
  | { kind: "two_factor"; email: string }
  | { kind: "enroll"; email: string; setup: TwoFactorSetup }
  | { kind: "recovery"; codes: string[]; redirectTo: string };

const message = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Something went wrong. Please try again.";

function ssoUrl(returnTo: string, email?: string) {
  const params = new URLSearchParams({ returnTo });
  if (email) params.set("email", email);
  return `/api/v1/auth/login?${params}`;
}

/**
 * A full navigation on purpose: SSO starts at an API route that redirects to the identity
 * provider. `location.assign` rather than a form post, because the page's CSP has
 * `form-action 'self'`, which browsers also apply to the redirect to an external provider.
 */
function goTo(url: string) {
  window.location.assign(url);
}

function PrimaryButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="group flex h-12 w-full items-center justify-center gap-2.5 rounded-lg bg-primary-solid text-[15px] font-medium text-primary-foreground shadow-[0_1px_0_0_oklch(1_0_0/0.18)_inset,0_10px_30px_-10px_var(--primary-glow)] transition-colors hover:bg-primary-solid-hover disabled:opacity-80"
    >
      {busy && <Loader2 className="size-[18px] animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] leading-relaxed"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <span>{text}</span>
    </div>
  );
}

/** The account being signed in to, with a way back to change it. */
function Account({ email, onChange }: { email: string; onChange: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface/70 px-3.5 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[13px] font-semibold uppercase text-primary">
        {email[0]}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px]">{email}</span>
      <button
        type="button"
        onClick={onChange}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-muted hover:bg-surface-sunken hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Change
      </button>
    </div>
  );
}

export function SignInForm({
  returnTo,
  initialEmail,
}: {
  returnTo: string;
  initialEmail?: string;
}) {
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const focus = useRef<HTMLInputElement>(null);

  useEffect(() => {
    focus.current?.focus();
  }, [step.kind, useRecovery]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  const afterStep = (email: string, raw: unknown) => {
    const next = SignInStepSchema.parse(raw);
    if (next.status === "signed_in") {
      if (next.recoveryCodes?.length) {
        setStep({ kind: "recovery", codes: next.recoveryCodes, redirectTo: next.redirectTo });
        setBusy(false);
      } else goTo(next.redirectTo);
      return;
    }
    setBusy(false);
    setUseRecovery(false);
    setStep(
      next.status === "two_factor_required"
        ? { kind: "two_factor", email }
        : { kind: "enroll", email, setup: next.setup },
    );
  };

  const onEmail = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (!email) {
      goTo(ssoUrl(returnTo));
      setBusy(true);
      return;
    }
    void run(async () => {
      const methods = await api("/api/v1/auth/discover", {
        method: "POST",
        body: { email },
        schema: DiscoverSignInResponseSchema,
      });
      if (methods.password) {
        setStep({
          kind: "password",
          email: email.toLowerCase(),
          sso: methods.sso,
          passwordReset: methods.passwordReset,
        });
        setBusy(false);
      } else if (methods.sso) {
        goTo(ssoUrl(returnTo, email));
      } else {
        setError(
          "Your organisation isn't set up to sign in here yet. Check the email address, or ask your administrator.",
        );
        setBusy(false);
      }
    });
  };

  const back = () => {
    setStep({ kind: "email" });
    setError(null);
  };

  if (step.kind === "email") {
    return (
      <form onSubmit={onEmail} className="mt-8 space-y-3" noValidate>
        <label htmlFor="sign-in-email" className="block text-[13px] font-medium">
          Work email
        </label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            ref={focus}
            id="sign-in-email"
            name="email"
            type="email"
            defaultValue={initialEmail}
            autoComplete="username"
            inputMode="email"
            placeholder="you@company.com"
            className="h-12 w-full rounded-lg border border-border-strong bg-surface-sunken pl-10 pr-3 text-[15px] text-foreground placeholder:text-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
          />
        </div>
        <Problem text={error} />
        <PrimaryButton busy={busy}>
          Continue
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </PrimaryButton>
        <div className="flex items-center gap-3 py-1 text-[11.5px] uppercase tracking-[0.14em] text-subtle">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            const email = String(
              new FormData(e.currentTarget.form ?? undefined).get("email") ?? "",
            ).trim();
            setBusy(true);
            goTo(ssoUrl(returnTo, email || undefined));
          }}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-border-strong bg-surface/70 text-[14.5px] font-medium text-foreground transition-colors hover:bg-surface-raised disabled:opacity-70"
        >
          <Fingerprint className="size-[18px]" aria-hidden />
          Continue with single sign-on
        </button>
        <p className="text-[12px] leading-relaxed text-subtle">
          Continue asks for your Neural Frontier password, or sends you to your organisation&apos;s
          identity provider when it requires one. With single sign-on, an empty email uses this
          deployment&apos;s default provider.
        </p>
      </form>
    );
  }

  if (step.kind === "password") {
    return (
      <form
        className="mt-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const password = String(new FormData(e.currentTarget).get("password") ?? "");
          if (!password) return setError("Enter your password.");
          void run(async () =>
            afterStep(
              step.email,
              await api("/api/v1/auth/password", {
                method: "POST",
                body: { email: step.email, password, returnTo },
              }),
            ),
          );
        }}
      >
        {/* Lets password managers pair the account with the password. */}
        <input type="hidden" name="username" autoComplete="username" value={step.email} />
        <Account email={step.email} onChange={back} />
        <label htmlFor="sign-in-password" className="block pt-2 text-[13px] font-medium">
          Password
        </label>
        <PasswordInput
          ref={focus}
          id="sign-in-password"
          name="password"
          autoComplete="current-password"
          aria-invalid={!!error}
        />
        <Problem text={error} />
        <PrimaryButton busy={busy}>
          <KeyRound className="size-[18px]" aria-hidden /> Sign in
        </PrimaryButton>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[12.5px]">
          {step.passwordReset ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("/api/v1/auth/password-reset", {
                    method: "POST",
                    body: { email: step.email },
                  });
                  setStep({ kind: "reset_sent", email: step.email });
                  setBusy(false);
                })
              }
              className="font-medium text-primary hover:underline"
            >
              Forgot password?
            </button>
          ) : (
            <span className="text-subtle">
              Forgot it? Your administrator can send you a reset link.
            </span>
          )}
          {step.sso && (
            <button
              type="button"
              onClick={() => {
                setBusy(true);
                goTo(ssoUrl(returnTo, step.email));
              }}
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              <Fingerprint className="size-3.5" aria-hidden /> Use single sign-on instead
            </button>
          )}
        </div>
      </form>
    );
  }

  if (step.kind === "reset_sent") {
    return (
      <div className="mt-8 space-y-4" role="status">
        <Account email={step.email} onChange={back} />
        <div className="flex items-start gap-3 pt-1">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <MailCheck className="size-[18px]" aria-hidden />
          </span>
          <div>
            <p className="text-[14.5px] font-medium">Check your email</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              If there&apos;s an account for {step.email}, we&apos;ve sent a link to choose a new
              password. It works once and expires in 24 hours. Nothing arrived after a few minutes?
              Check spam, or ask your administrator.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={back}
          className="text-[12.5px] font-medium text-primary hover:underline"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  if (step.kind === "two_factor") {
    return (
      <form
        className="mt-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
          if (!code)
            return setError(useRecovery ? "Enter a recovery code." : "Enter the 6-digit code.");
          void run(async () =>
            afterStep(
              step.email,
              await api("/api/v1/auth/two-factor", { method: "POST", body: { code } }),
            ),
          );
        }}
      >
        <Account email={step.email} onChange={back} />
        <div className="flex items-start gap-3 pt-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Smartphone className="size-[18px]" aria-hidden />
          </span>
          <div>
            <p className="text-[14px] font-medium">
              {useRecovery ? "Enter a recovery code" : "Enter the code from your authenticator app"}
            </p>
            <p className="text-[12.5px] leading-relaxed text-muted">
              {useRecovery
                ? "One of the codes you saved when you turned on two-factor. Each works once."
                : "Open the app on your phone and type the current 6-digit code for Neural Frontier."}
            </p>
          </div>
        </div>
        <label htmlFor="sign-in-code" className="sr-only">
          {useRecovery ? "Recovery code" : "Authentication code"}
        </label>
        <CodeInput
          key={useRecovery ? "recovery" : "totp"}
          ref={focus}
          id="sign-in-code"
          name="code"
          recovery={useRecovery}
          aria-invalid={!!error}
        />
        <Problem text={error} />
        <PrimaryButton busy={busy}>
          <ShieldCheck className="size-[18px]" aria-hidden /> Verify
        </PrimaryButton>
        <button
          type="button"
          onClick={() => {
            setUseRecovery((v) => !v);
            setError(null);
          }}
          className="text-[12.5px] font-medium text-primary hover:underline"
        >
          {useRecovery
            ? "Use my authenticator app instead"
            : "Lost your phone? Use a recovery code"}
        </button>
      </form>
    );
  }

  if (step.kind === "enroll") {
    return (
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
          if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from your app.");
          void run(async () =>
            afterStep(
              step.email,
              await api("/api/v1/auth/two-factor", { method: "POST", body: { code } }),
            ),
          );
        }}
      >
        <Account email={step.email} onChange={back} />
        <div className="rounded-lg border border-primary/25 bg-primary-soft/40 px-3.5 py-2.5 text-[13px] leading-relaxed">
          <span className="font-medium">Your organisation requires two-step sign-in.</span> Set up
          an authenticator app now. It takes about a minute, and you&apos;ll use it each time you
          sign in.
        </div>
        <AuthenticatorSetup setup={step.setup} />
        <label htmlFor="enroll-code" className="sr-only">
          6-digit code
        </label>
        <CodeInput ref={focus} id="enroll-code" name="code" aria-invalid={!!error} />
        <Problem text={error} />
        <PrimaryButton busy={busy}>
          <ShieldCheck className="size-[18px]" aria-hidden /> Turn on and sign in
        </PrimaryButton>
        <p className="text-[12px] text-subtle">This set-up expires after five minutes.</p>
      </form>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
          <ShieldCheck className="size-[18px]" aria-hidden />
        </span>
        <div>
          <p className="text-[15px] font-medium">Two-step sign-in is on</p>
          <p className="text-[13px] leading-relaxed text-muted">
            Save these recovery codes. If you lose your phone, each one signs you in once. You
            won&apos;t see them again.
          </p>
        </div>
      </div>
      <RecoveryCodes
        codes={step.codes}
        confirmLabel="Continue to the Admin Center"
        onConfirm={() => goTo(step.redirectTo)}
      />
    </div>
  );
}
