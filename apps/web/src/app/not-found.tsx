import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="text-center animate-fade-in">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/20">
          <Compass className="size-6" aria-hidden />
        </div>
        <p className="font-mono text-[12px] text-subtle">404</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          This page is beyond the frontier
        </h1>
        <p className="mt-2 text-[14px] text-muted">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-primary-solid px-4 text-sm font-medium text-primary-foreground hover:bg-primary-solid-hover"
        >
          Back to overview
        </Link>
      </div>
    </main>
  );
}
