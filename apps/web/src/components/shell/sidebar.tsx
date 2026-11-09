"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/cn";
import { usePermissions } from "@/lib/session";
import { NAV } from "./navigation";

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = usePermissions();

  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {NAV.map(({ group, items }) => {
        const visible = items.filter((i) => can(i.permission));
        if (visible.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-1.5 px-3 text-[10.5px] font-medium uppercase tracking-[0.14em] text-subtle">
              {group}
            </p>
            <ul className="flex flex-col gap-0.5">
              {visible.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors",
                        active
                          ? "text-foreground"
                          : "text-muted hover:bg-surface-sunken/70 hover:text-foreground",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="nav-active"
                          transition={{ type: "spring", stiffness: 500, damping: 40 }}
                          className="absolute inset-0 rounded-lg bg-primary-soft ring-1 ring-inset ring-primary/25"
                        />
                      )}
                      <item.icon
                        className={cn(
                          "relative size-[17px]",
                          active ? "text-primary" : "text-subtle group-hover:text-muted",
                        )}
                        aria-hidden
                      />
                      <span className="relative">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const { session } = usePermissions();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-border bg-surface/60 backdrop-blur-xl lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Neural Frontier home">
          <Wordmark />
        </Link>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
        <SidebarNav />
      </div>
      {session && (
        <div className="m-3 rounded-xl border border-border bg-surface-sunken/60 p-3.5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-subtle">
            Organisation
          </p>
          <p className="mt-1 truncate text-[13.5px] font-semibold">{session.tenant.name}</p>
          <p className="truncate font-mono text-[11px] text-subtle">{session.tenant.slug}</p>
        </div>
      )}
    </aside>
  );
}
