import type { Metadata } from "next";
import { LogoMark } from "@/components/brand/logo";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set your password" };

/** Landing page of a one-time set-up/reset link (the token is in the URL fragment). */
export default function SetupPage() {
  return (
    <main className="dark relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-16 text-foreground">
      <div aria-hidden className="absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--aurora-a),transparent)] blur-2xl animate-aurora" />
        <div className="absolute -bottom-40 right-[-10%] h-[420px] w-[520px] rounded-full bg-[radial-gradient(closest-side,var(--aurora-b),transparent)] blur-2xl animate-aurora [animation-delay:-6s]" />
        <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_50%_0%,black,transparent_65%)]" />
      </div>
      <div className="relative w-full max-w-[440px] animate-fade-in">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark className="size-9" />
          <span className="text-[17px] font-semibold tracking-tight">Neural Frontier</span>
        </div>
        <div className="rounded-2xl border border-border bg-surface/80 p-6 shadow-pop backdrop-blur sm:p-8">
          <SetupForm />
        </div>
      </div>
    </main>
  );
}
