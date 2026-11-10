"use client";

import { passwordProblems, type TwoFactorSetup } from "@nf/contracts";
import { Check, Copy, Download, Eye, EyeOff, X } from "lucide-react";
import { type ComponentProps, useId, useState } from "react";
import { QrCode } from "@/components/ui/qr-code";
import { cn } from "@/lib/cn";

const field =
  "w-full rounded-lg border border-border-strong bg-surface-sunken px-3.5 text-[15px] text-foreground placeholder:text-subtle transition-shadow focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30 aria-invalid:border-danger";

/** Password input with a show/hide toggle. */
export function PasswordInput({ className, ...props }: ComponentProps<"input">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        type={shown ? "text" : "password"}
        spellCheck={false}
        autoCapitalize="none"
        className={cn(field, "h-12 pr-11", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-subtle hover:bg-surface-raised hover:text-foreground"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/**
 * Live checklist for a new password, from the same rules the API enforces. Length first:
 * a long passphrase beats symbol rules.
 */
export function PasswordChecklist({
  password,
  minLength,
  email,
}: {
  password: string;
  minLength: number;
  email?: string | null;
}) {
  const problems = passwordProblems(password, { minLength, email });
  const length = [...password].length;
  const strength = Math.min(1, length / Math.max(minLength * 1.6, 20));
  const ok = problems.length === 0 && length > 0;
  const rules = [
    { label: `At least ${minLength} characters`, met: length >= minLength },
    {
      label: "Not a commonly used password",
      met: length > 0 && !problems.includes("Avoid commonly used passwords"),
    },
    {
      label: "Not your email address",
      met: length > 0 && !problems.includes("Don't include your email address"),
    },
    {
      label: "No simple sequences or repeats",
      met:
        length > 0 &&
        !problems.includes("Avoid sequences and repeated characters") &&
        !problems.includes("Use more than a few different characters"),
    },
  ];
  return (
    <div className="space-y-2.5" aria-live="polite">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={cn(
            "h-full rounded-full transition-[width,background] duration-300",
            !ok ? "bg-warning" : strength < 1 ? "bg-primary" : "bg-success",
          )}
          style={{ width: `${Math.max(4, strength * 100)}%` }}
        />
      </div>
      <ul className="grid gap-1 text-[12.5px] sm:grid-cols-2">
        {rules.map((r) => (
          <li
            key={r.label}
            className={cn("flex items-center gap-1.5", r.met ? "text-foreground" : "text-subtle")}
          >
            {r.met ? (
              <Check className="size-3.5 shrink-0 text-success" aria-hidden />
            ) : (
              <X className="size-3.5 shrink-0 opacity-60" aria-hidden />
            )}
            {r.label}
            <span className="sr-only">{r.met ? "(met)" : "(not met)"}</span>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-subtle">
        Tip: a few unrelated words make a strong password that is easy to remember.
      </p>
    </div>
  );
}

/** One-time code entry: digits for an authenticator, or a recovery code. */
export function CodeInput({
  recovery,
  className,
  ...props
}: ComponentProps<"input"> & { recovery?: boolean }) {
  return (
    <input
      inputMode={recovery ? "text" : "numeric"}
      autoComplete="one-time-code"
      spellCheck={false}
      autoCapitalize="none"
      maxLength={recovery ? 11 : 6}
      placeholder={recovery ? "xxxxx-xxxxx" : "000000"}
      className={cn(
        field,
        "h-14 text-center font-mono text-[22px] tracking-[0.35em] placeholder:tracking-[0.35em] placeholder:text-subtle/50",
        recovery && "text-[17px] tracking-[0.15em]",
        className,
      )}
      {...props}
    />
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface-sunken hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** QR code plus the key for typing in by hand, and what to do with them. */
export function AuthenticatorSetup({ setup }: { setup: TwoFactorSetup }) {
  const grouped = setup.secret.replace(/(.{4})/g, "$1 ").trim();
  return (
    <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="mx-auto rounded-xl border border-border bg-white p-2 shadow-card">
        <QrCode
          value={setup.otpauthUri}
          label="QR code for your authenticator app"
          className="size-44"
        />
      </div>
      <ol className="space-y-3 text-[13px] leading-relaxed text-muted">
        <li>
          <span className="font-medium text-foreground">1.</span> Open an authenticator app on your
          phone: Microsoft Authenticator, Google Authenticator, 1Password, Bitwarden or any app that
          supports time-based codes.
        </li>
        <li>
          <span className="font-medium text-foreground">2.</span> Scan the QR code. Can&apos;t scan?
          Enter this key instead:
          <span className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-foreground">
              {grouped}
            </code>
            <CopyButton value={setup.secret} label="Copy the set-up key" />
          </span>
        </li>
        <li>
          <span className="font-medium text-foreground">3.</span> Type the 6-digit code it shows.
        </li>
      </ol>
    </div>
  );
}

/** Recovery codes, shown once: copy, download, and an explicit "I saved them". */
export function RecoveryCodes({
  codes,
  confirmLabel,
  onConfirm,
}: {
  codes: string[];
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const id = useId();
  const text = `Neural Frontier recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-sunken p-4 font-mono text-[14px] tracking-wide">
        {codes.map((c) => (
          <li key={c} className="text-center">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={codes.join("\n")} label="Copy all recovery codes" />
        <button
          type="button"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "neural-frontier-recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface-sunken hover:text-foreground"
        >
          <Download className="size-3.5" /> Download .txt
        </button>
      </div>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed"
      >
        <input
          id={id}
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        I&apos;ve saved these codes. Each one gets me in once if I lose my phone.
      </label>
      <button
        type="button"
        disabled={!saved}
        onClick={onConfirm}
        className="flex h-11 w-full items-center justify-center rounded-lg bg-primary-solid text-[14.5px] font-medium text-primary-foreground transition-colors hover:bg-primary-solid-hover disabled:opacity-50"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
