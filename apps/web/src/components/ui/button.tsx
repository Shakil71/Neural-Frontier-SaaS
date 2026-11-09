import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary-solid text-primary-foreground shadow-[0_1px_0_0_oklch(1_0_0/0.18)_inset,0_6px_20px_-8px_var(--primary-glow)] hover:bg-primary-solid-hover",
        secondary:
          "border border-border-strong bg-surface-raised text-foreground shadow-card hover:bg-surface-sunken",
        ghost: "text-muted hover:bg-surface-sunken hover:text-foreground",
        danger: "bg-danger text-white hover:opacity-90",
        "danger-soft": "bg-danger-soft text-danger hover:bg-danger/20",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-[13px]",
        md: "h-9 rounded-md px-4 text-sm",
        lg: "h-11 rounded-lg px-5 text-[15px]",
        icon: "size-9 rounded-md",
        "icon-sm": "size-8 rounded-md",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  );
}
