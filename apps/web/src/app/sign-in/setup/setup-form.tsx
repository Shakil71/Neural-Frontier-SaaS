"use client";

import { passwordProblems, type SignInLinkInfo, SignInLinkInfoSchema } from "@nf/contracts";
import { CircleCheck, KeyRound, Link2Off, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PasswordChecklist, PasswordInput } from "@/components/auth/auth-parts";
import { api, ApiRequestError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type State =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; token: string; info: SignInLinkInfo }
  | { kind: "done"; email: string };

const NO_LINK =
  "This page needs the full link your administrator sent you. Open it again from the message.";

export function SetupForm() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = window.location.hash.slice(1);
    // Drop the token from the address bar and history as soon as it has been read.
    window.history.replaceState(null, "", window.location.pathname);
    const load = async (): Promise<State> => {
      if (!/^nfl_[A-Za-z0-9_-]{43}$/.test(token)) return { kind: "invalid", message: NO_LINK };
      try {
        const info = await api("/api/v1/auth/sign-in-links/inspect", {
          method: "POST",
          body: { token },
          schema: SignInLinkInfoSchema,
        });
        return { kind: "ready", token, info };
      } catch (err) {
        return {
          kind: "invalid",
          message:
            err instanceof ApiRequestError ? err.message : "Couldn't check this link. Try again.",
        };
      }
    };
    void load().then(setState);
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Checking your link…
      </div>
    );
  }

  if (state.kind === "invalid") {
    return (
      <div className="space-y-4 py-2">
        <span className="grid size-11 place-items-center rounded-xl bg-danger-soft text-danger">
          <Link2Off className="size-5" aria-hidden />
        </span>
        <h1 className="text-[22px] font-semibold tracking-tight">This link can&apos;t be used</h1>
        <p className="text-[14px] leading-relaxed text-muted">{state.message}</p>
        <Link
          href="/sign-in"
          className="inline-block text-[13.5px] font-medium text-primary hover:underline"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  if (state.kind === "done") {
    return (
      <div className="space-y-4 py-2">
        <span className="grid size-11 place-items-center rounded-xl bg-success-soft text-success">
          <CircleCheck className="size-5" aria-hidden />
        </span>
        <h1 className="text-[22px] font-semibold tracking-tight">Your password is set</h1>
        <p className="text-[14px] leading-relaxed text-muted">
          Sign in with <span className="text-foreground">{state.email}</span> and your new password.
        </p>
        <Link
          href={`/sign-in?passwordSet=1&email=${encodeURIComponent(state.email)}`}
          className="flex h-11 items-center justify-center rounded-lg bg-primary-solid text-[14.5px] font-medium text-primary-foreground hover:bg-primary-solid-hover"
        >
          Continue to sign in
        </Link>
      </div>
    );
  }

  const { info, token } = state;
  const problems = passwordProblems(password, {
    minLength: info.minPasswordLength,
    email: info.email,
  });
  const mismatch = confirm.length > 0 && confirm !== password;
  const reset = info.purpose === "reset";

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length) return setError(problems[0]!);
        if (password !== confirm) return setError("The two passwords don't match.");
        setBusy(true);
        setError(null);
        api("/api/v1/auth/sign-in-links/redeem", { method: "POST", body: { token, password } })
          .then(() => setState({ kind: "done", email: info.email }))
          .catch((err: unknown) => {
            setError(
              err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.",
            );
            setBusy(false);
          });
      }}
    >
      <div>
        <p className="text-[11.5px] font-medium uppercase tracking-[0.18em] text-accent">
          {info.tenantName}
        </p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em]">
          {reset ? "Choose a new password" : `Welcome, ${info.displayName.split(" ")[0]}`}
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
          {reset
            ? "Your administrator reset your password. Choose a new one to sign in again. Any open sessions have been signed out."
            : "Set a password for your Neural Frontier account."}{" "}
          This link works once and expires {formatDateTime(info.expiresAt)}.
        </p>
      </div>

      <input
        type="text"
        name="username"
        autoComplete="username"
        value={info.email}
        readOnly
        hidden
      />
      <div className="space-y-1.5">
        <label className="text-[13px] font-medium">Account</label>
        <p className="rounded-lg border border-border bg-surface-sunken px-3.5 py-2.5 text-[14px]">
          {info.email}
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="new-password" className="text-[13px] font-medium">
          New password
        </label>
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <PasswordChecklist
        password={password}
        minLength={info.minPasswordLength}
        email={info.email}
      />
      <div className="space-y-1.5">
        <label htmlFor="confirm-password" className="text-[13px] font-medium">
          Confirm password
        </label>
        <PasswordInput
          id="confirm-password"
          autoComplete="new-password"
          value={confirm}
          aria-invalid={mismatch}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && (
          <p className="text-[12.5px] text-danger">The passwords don&apos;t match yet.</p>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px]"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary-solid text-[15px] font-medium text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary-glow)] hover:bg-primary-solid-hover disabled:opacity-70"
      >
        {busy ? (
          <Loader2 className="size-[18px] animate-spin" aria-hidden />
        ) : (
          <KeyRound className="size-[18px]" aria-hidden />
        )}
        {reset ? "Save new password" : "Set password"}
      </button>
    </form>
  );
}
