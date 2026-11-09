import { ArrowRight, Fingerprint, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { LogoMark } from "@/components/brand/logo";
import { SIGN_IN_ERRORS } from "@/lib/audit-labels";

export const metadata: Metadata = { title: "Sign in" };

function safeReturnTo(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "/";
}

/** Decorative "neural horizon": nodes along rising ridgelines, softly pulsing. */
function NeuralHorizon() {
  const ridges = [
    { y: 300, amp: 40, nodes: 7, delay: 0 },
    { y: 360, amp: 56, nodes: 9, delay: 0.6 },
    { y: 430, amp: 72, nodes: 11, delay: 1.2 },
  ];
  return (
    <svg
      aria-hidden
      viewBox="0 0 800 520"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-x-0 bottom-0 h-[70%] w-full"
    >
      <defs>
        <linearGradient id="nh-stroke" x1="0" x2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0" />
          <stop offset=".5" stopColor="var(--primary)" stopOpacity=".7" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity=".15" />
        </linearGradient>
      </defs>
      {ridges.map((r, ri) => {
        const pts = Array.from({ length: r.nodes }, (_, i) => {
          const x = (i / (r.nodes - 1)) * 800;
          const y =
            r.y - Math.sin((i / (r.nodes - 1)) * Math.PI * 1.15 + ri) * r.amp - (i / r.nodes) * 60;
          return [x, y] as const;
        });
        const d = pts
          .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
          .join(" ");
        return (
          <g key={ri}>
            <path d={d} fill="none" stroke="url(#nh-stroke)" strokeWidth={1.2} />
            {pts.map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={i % 3 === 0 ? 3 : 2}
                fill={i % 2 ? "var(--accent)" : "var(--primary)"}
                className="animate-pulse-node"
                style={{ animationDelay: `${r.delay + i * 0.25}s` }}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  const errorCode = typeof params.error === "string" ? params.error : null;
  const error = errorCode
    ? (SIGN_IN_ERRORS[errorCode] ?? "Sign-in couldn't be completed. Please try again.")
    : null;
  const signedOut = params.signedOut === "1";

  return (
    <main className="dark relative grid min-h-dvh overflow-hidden bg-background text-foreground lg:grid-cols-[1.15fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden border-r border-border lg:block">
        <div aria-hidden className="absolute inset-0">
          <div className="absolute -left-40 -top-40 h-[640px] w-[640px] rounded-full bg-[radial-gradient(closest-side,var(--aurora-a),transparent)] blur-2xl animate-aurora" />
          <div className="absolute -right-32 top-24 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,var(--aurora-b),transparent)] blur-2xl animate-aurora [animation-delay:-7s]" />
          <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_30%_20%,black,transparent_70%)]" />
        </div>
        <NeuralHorizon />
        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <LogoMark className="size-9" />
            <span className="text-[17px] font-semibold tracking-tight">Neural Frontier</span>
          </div>
          <div className="max-w-xl pb-24">
            <p className="mb-5 text-[11.5px] font-medium uppercase tracking-[0.2em] text-accent">
              Admin Center
            </p>
            <h1 className="text-[44px] font-semibold leading-[1.05] tracking-[-0.035em] xl:text-[54px]">
              <span className="text-gradient">One Intelligent Platform.</span>
              <br />
              <span className="text-foreground/90">Infinite Possibilities.</span>
            </h1>
          </div>
        </div>
      </section>

      {/* Sign-in panel */}
      <section className="relative flex items-center justify-center px-6 py-16">
        <div aria-hidden className="absolute inset-0 lg:hidden">
          <div className="absolute -top-40 left-1/2 h-[480px] w-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--aurora-a),transparent)] blur-2xl" />
        </div>
        <div className="relative w-full max-w-[400px] animate-fade-in">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <LogoMark className="size-9" />
            <span className="text-[17px] font-semibold tracking-tight">Neural Frontier</span>
          </div>

          <h2 className="text-[28px] font-semibold tracking-[-0.025em]">Welcome back</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
            Sign in with your organisation&apos;s identity provider to open the Admin Center.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-7 flex gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-relaxed text-foreground"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <span>{error}</span>
            </div>
          )}
          {signedOut && !error && (
            <div
              role="status"
              className="mt-7 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-[13px] text-muted"
            >
              You&apos;ve been signed out.
            </div>
          )}

          <a
            href={`/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
            className="group mt-8 flex h-12 w-full items-center justify-center gap-2.5 rounded-lg bg-primary-solid text-[15px] font-medium text-primary-foreground shadow-[0_1px_0_0_oklch(1_0_0/0.18)_inset,0_10px_30px_-10px_var(--primary-glow)] transition-colors hover:bg-primary-solid-hover"
          >
            <Fingerprint className="size-[18px]" aria-hidden />
            Continue with single sign-on
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </a>

          <div className="mt-10 flex items-start gap-3 rounded-xl border border-border bg-surface/60 p-4 backdrop-blur">
            <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-success" aria-hidden />
            <p className="text-[12.5px] leading-relaxed text-muted">
              Neural Frontier never sees your password. Authentication happens at your identity
              provider using OpenID Connect with PKCE; sessions are bound to this browser and expire
              automatically.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
