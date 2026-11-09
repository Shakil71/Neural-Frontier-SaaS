"use client";

import { X } from "lucide-react";
import { Dialog as D, DropdownMenu as M, Tooltip as T } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ── Dialog ───────────────────────────────────────────────────────────── */

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlay =
  "fixed inset-0 z-50 bg-[oklch(0.1_0.03_268/0.55)] backdrop-blur-[3px] data-[state=open]:animate-fade-in";

export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          "fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 rounded-xl border border-border-strong bg-surface-raised p-6 shadow-pop data-[state=open]:animate-fade-in",
          className,
        )}
      >
        <div className="mb-5 pr-8">
          <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
          {description ? (
            <D.Description className="mt-1.5 text-[13px] leading-relaxed text-muted">
              {description}
            </D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
        </div>
        {children}
        <D.Close
          className="absolute right-4 top-4 rounded-md p-1.5 text-subtle hover:bg-surface-sunken hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

/* ── Sheet (side panel) ───────────────────────────────────────────────── */

export function SheetContent({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-border-strong bg-surface shadow-pop data-[state=open]:animate-sheet-in">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <D.Title className="truncate text-base font-semibold tracking-tight">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 truncate text-[13px] text-muted">
                {description}
              </D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close
            className="rounded-md p-1.5 text-subtle hover:bg-surface-sunken hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

/* ── Dropdown menu ────────────────────────────────────────────────────── */

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={8}
        className={cn(
          "z-50 min-w-56 rounded-lg border border-border-strong bg-surface-raised p-1.5 shadow-pop data-[state=open]:animate-fade-in",
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-foreground outline-none data-[highlighted]:bg-surface-sunken [&_svg]:size-4 [&_svg]:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export const MenuSeparator = () => <M.Separator className="my-1.5 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <M.Label className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-subtle">
    {children}
  </M.Label>
);

/* ── Tooltip ──────────────────────────────────────────────────────────── */

export const TooltipProvider = T.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 text-[12px] text-foreground shadow-pop data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
