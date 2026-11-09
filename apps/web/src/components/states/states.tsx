import { AlertTriangle, Lock, type LucideIcon, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";

function Shell({
  icon: Icon,
  tone,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  tone: "neutral" | "danger" | "primary";
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const ring = {
    neutral: "text-muted bg-surface-sunken",
    danger: "text-danger bg-danger-soft",
    primary: "text-primary bg-primary-soft",
  }[tone];
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-14 text-center animate-fade-in",
        className,
      )}
    >
      <div
        className={cn(
          "mb-4 grid size-12 place-items-center rounded-xl ring-1 ring-inset ring-border",
          ring,
        )}
      >
        <Icon className="size-5" aria-hidden />
      </div>
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      {children && (
        <div className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{children}</div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function EmptyState(props: {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return <Shell tone="primary" {...props} />;
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const e = error instanceof ApiRequestError ? error : null;
  return (
    <Shell
      icon={AlertTriangle}
      tone="danger"
      title="Something went wrong"
      className={className}
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        )
      }
    >
      {e?.message ?? "The request couldn't be completed."}
      {e?.requestId && (
        <span className="mt-2 block font-mono text-[11px] text-subtle">
          Request ID {e.requestId}
        </span>
      )}
    </Shell>
  );
}

export function ForbiddenState({
  permission,
  className,
}: {
  permission: string;
  className?: string;
}) {
  return (
    <Shell
      icon={Lock}
      tone="neutral"
      title="You don't have access to this area"
      className={className}
    >
      This page requires the{" "}
      <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[12px]">
        {permission}
      </code>{" "}
      permission. Ask a Tenant Owner to grant you a role that includes it.
    </Shell>
  );
}
