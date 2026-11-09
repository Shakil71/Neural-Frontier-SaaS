import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { avatarHue, initials } from "@/lib/format";

/* ── Card ─────────────────────────────────────────────────────────────── */

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-surface shadow-card animate-fade-in",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

/* ── Badge ────────────────────────────────────────────────────────────── */

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-5",
  {
    variants: {
      tone: {
        neutral: "bg-surface-sunken text-muted ring-1 ring-inset ring-border",
        primary: "bg-primary-soft text-primary",
        accent: "bg-accent-soft text-accent",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  dot,
  children,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ── Form controls ────────────────────────────────────────────────────── */

const control =
  "w-full rounded-md border border-border-strong bg-surface-sunken px-3 text-sm text-foreground placeholder:text-subtle transition-shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:border-primary aria-invalid:border-danger disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(control, "min-h-24 py-2 leading-relaxed", className)} {...props} />
  );
}

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-9 cursor-pointer pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-[13px] font-medium text-foreground", className)} {...props} />;
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-[12.5px] text-danger">
      {children}
    </p>
  );
}

/* ── Feedback ─────────────────────────────────────────────────────────── */

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-gradient-to-r from-surface-sunken via-surface-raised to-surface-sunken",
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-surface-sunken px-1 font-mono text-[10.5px] text-muted",
        className,
      )}
      {...props}
    />
  );
}

/* ── Avatar ───────────────────────────────────────────────────────────── */

export function Avatar({
  name,
  seed,
  size = 32,
  className,
}: {
  name: string;
  seed: string;
  size?: number;
  className?: string;
}) {
  const hue = avatarHue(seed);
  const style = {
    width: size,
    height: size,
    fontSize: size * 0.36,
    background: `linear-gradient(135deg, oklch(0.62 0.16 ${hue}), oklch(0.5 0.17 ${(hue + 40) % 360}))`,
  } satisfies CSSProperties;
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white shadow-[0_0_0_2px_var(--surface)]",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/* ── Status dot ───────────────────────────────────────────────────────── */

export function StatusDot({ tone }: { tone: "success" | "warning" | "danger" | "neutral" }) {
  const color = {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    neutral: "bg-subtle",
  }[tone];
  return (
    <span className="relative inline-flex size-2.5" aria-hidden>
      {tone === "success" && (
        <span className={cn("absolute inset-0 animate-ping rounded-full opacity-40", color)} />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full", color)} />
    </span>
  );
}
