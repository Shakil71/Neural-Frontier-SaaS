import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * The Neural Frontier mark: a rising frontier ridge drawn as three connected neurons
 * over a horizon arc. Original artwork; scales cleanly from 16px to hero sizes.
 */
export function LogoMark({
  className,
  title = "Neural Frontier",
}: {
  className?: string;
  title?: string;
}) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`${id}-g`} x1="2" y1="30" x2="30" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${id}-g)`} />
      <path
        d="M6 23.5c3.2-2.6 6.6-3.9 10-3.9s6.8 1.3 10 3.9"
        fill="none"
        stroke="white"
        strokeOpacity=".45"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M8.5 18.5 14 10l3.6 5.2L23.5 8"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="18.5" r="2" fill="white" />
      <circle cx="14" cy="10" r="2" fill="white" />
      <circle cx="17.6" cy="15.2" r="1.6" fill="white" fillOpacity=".85" />
      <circle cx="23.5" cy="8" r="2.4" fill="white" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="size-7" />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          Neural Frontier
        </span>
        <span className="mt-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-subtle">
          Admin Center
        </span>
      </span>
    </span>
  );
}
