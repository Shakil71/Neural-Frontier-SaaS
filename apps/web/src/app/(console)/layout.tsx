"use client";

import { LogOut, ShieldOff } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api";
import { useSession, useSignOut } from "@/lib/session";

function Splash() {
  return (
    <div
      className="grid min-h-dvh place-items-center"
      role="status"
      aria-label="Loading Neural Frontier"
    >
      <div className="flex flex-col items-center gap-4">
        <LogoMark className="size-11 animate-pulse" />
        <div className="h-0.5 w-28 overflow-hidden rounded-full bg-surface-sunken">
          <div className="h-full w-1/2 animate-[aurora_1.2s_ease-in-out_infinite_alternate] rounded-full bg-gradient-to-r from-primary to-accent" />
        </div>
      </div>
    </div>
  );
}

function NoAdminAccess({ name }: { name: string }) {
  const signOut = useSignOut();
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-md text-center animate-fade-in">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-surface-sunken ring-1 ring-inset ring-border">
          <ShieldOff className="size-6 text-muted" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">You&apos;re signed in, {name}</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Your account doesn&apos;t have administrative access to the Admin Center yet. A Tenant
          Owner can grant you a role from{" "}
          <span className="font-medium text-foreground">Identities</span>.
        </p>
        <Button variant="secondary" className="mt-6" onClick={() => void signOut()}>
          <LogOut /> Sign out
        </Button>
      </div>
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = useSession();

  if (session.isPending) return <Splash />;
  if (session.isError) {
    // 401 is already redirecting to sign-in.
    if (session.error instanceof ApiRequestError && session.error.status === 401) return <Splash />;
    return (
      <ErrorState
        className="min-h-dvh"
        error={session.error}
        onRetry={() => void session.refetch()}
      />
    );
  }
  if (session.data.permissions.length === 0)
    return <NoAdminAccess name={session.data.user.displayName} />;

  return (
    <div className="relative flex min-h-dvh">
      {/* Atmosphere: two slow aurora fields and a faint grid, behind everything. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 left-[18%] h-[520px] w-[720px] rounded-full bg-[radial-gradient(closest-side,var(--aurora-a),transparent)] blur-2xl animate-aurora" />
        <div className="absolute -top-32 right-[-8%] h-[440px] w-[560px] rounded-full bg-[radial-gradient(closest-side,var(--aurora-b),transparent)] blur-2xl animate-aurora [animation-delay:-6s]" />
        <div className="bg-grid absolute inset-x-0 top-0 h-[420px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      </div>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-8 sm:px-8 sm:py-10">
          {children}
        </main>
        <footer className="px-8 pb-6 text-[11.5px] text-subtle">
          Neural Frontier · One Intelligent Platform. Infinite Possibilities.
        </footer>
      </div>
    </div>
  );
}
