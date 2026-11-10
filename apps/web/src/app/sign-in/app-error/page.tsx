import { AppWindow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Can't sign in to this app" };

/** Problems with an application's sign-in request that must not be sent back to the app. */
const REASONS: Record<string, { title: string; body: string }> = {
  unknown_app: {
    title: "This app isn't registered",
    body: "The app asked to sign you in, but Neural Frontier doesn't know it. Its administrator needs to register it under Applications.",
  },
  bad_redirect: {
    title: "This app's sign-in address isn't allowed",
    body: "The app wanted to return you to an address that isn't registered for it. For your safety, we stopped here. Tell the app's administrator.",
  },
  app_disabled: {
    title: "This app is turned off",
    body: "An administrator has turned off sign-in for this app. Ask them if you need access.",
  },
  other_organisation: {
    title: "This app belongs to another organisation",
    body: "You're signed in to a different organisation than the one that registered this app. Sign out and sign in with the right account.",
  },
};

export default async function AppErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const reason = (await searchParams).reason;
  const r = REASONS[typeof reason === "string" ? reason : ""] ?? {
    title: "This app's sign-in request couldn't be completed",
    body: "Go back to the app and try again. If it keeps happening, tell its administrator.",
  };
  return (
    <main className="dark relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-16 text-foreground">
      <div aria-hidden className="absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--aurora-a),transparent)] blur-2xl" />
      </div>
      <div className="relative w-full max-w-[440px] animate-fade-in">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark className="size-9" />
          <span className="text-[17px] font-semibold tracking-tight">Neural Frontier</span>
        </div>
        <div className="space-y-4 rounded-2xl border border-border bg-surface/80 p-7 shadow-pop backdrop-blur">
          <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning">
            <AppWindow className="size-5" aria-hidden />
          </span>
          <h1 className="text-[22px] font-semibold tracking-tight">{r.title}</h1>
          <p className="text-[14px] leading-relaxed text-muted">{r.body}</p>
          <Link
            href="/"
            className="inline-block text-[13.5px] font-medium text-primary hover:underline"
          >
            Go to the Admin Center
          </Link>
        </div>
      </div>
    </main>
  );
}
