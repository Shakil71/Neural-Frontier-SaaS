"use client";

import { ArrowRight, Fingerprint, Loader2, Mail } from "lucide-react";
import { useState } from "react";

/**
 * Email-first sign-in. The address only picks the organisation's identity provider; identity
 * comes from the provider's signed ID token.
 *
 * Submitting navigates with `location.assign` rather than a native form post: the page's CSP has
 * `form-action 'self'`, which browsers also apply to the redirect to an external identity
 * provider. Navigation keeps that strict policy intact.
 */
export function SignInForm({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      method="get"
      action="/api/v1/auth/login"
      className="mt-8 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const email = new FormData(e.currentTarget).get("email");
        const params = new URLSearchParams({ returnTo });
        if (typeof email === "string" && email.trim()) params.set("email", email.trim());
        setBusy(true);
        // A full navigation on purpose: this is an API route that redirects to the IdP.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/api/v1/auth/login?${params}`);
      }}
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      <label htmlFor="sign-in-email" className="block text-[13px] font-medium">
        Work email
      </label>
      <div className="relative">
        <Mail
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <input
          id="sign-in-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          placeholder="you@company.com"
          className="h-12 w-full rounded-lg border border-border-strong bg-surface-sunken pl-10 pr-3 text-[15px] text-foreground placeholder:text-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="group flex h-12 w-full items-center justify-center gap-2.5 rounded-lg bg-primary-solid text-[15px] font-medium text-primary-foreground shadow-[0_1px_0_0_oklch(1_0_0/0.18)_inset,0_10px_30px_-10px_var(--primary-glow)] transition-colors hover:bg-primary-solid-hover disabled:opacity-80"
      >
        {busy ? (
          <Loader2 className="size-[18px] animate-spin" aria-hidden />
        ) : (
          <Fingerprint className="size-[18px]" aria-hidden />
        )}
        Continue with single sign-on
        <ArrowRight
          className="size-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
      <p className="text-[12px] leading-relaxed text-subtle">
        We send you to your organisation&apos;s sign-in page. Leave the email empty to use this
        deployment&apos;s default provider.
      </p>
    </form>
  );
}
