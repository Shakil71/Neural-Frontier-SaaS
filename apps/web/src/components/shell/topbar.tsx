"use client";

import { LogOut, Menu as MenuIcon, Monitor, Moon, Search, ShieldCheck, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Dialog as D } from "radix-ui";
import { useState, useSyncExternalStore } from "react";
import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/overlays";
import { Avatar, Kbd } from "@/components/ui/primitives";
import { usePermissions, useSignOut } from "@/lib/session";
import { CommandPalette } from "./command-palette";
import { SidebarNav } from "./sidebar";

function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];
  return (
    <>
      <MenuLabel>Theme</MenuLabel>
      {options.map((o) => (
        <MenuItem
          key={o.value}
          onSelect={() => setTheme(o.value)}
          aria-checked={theme === o.value}
          role="menuitemradio"
        >
          <o.icon />
          <span className="flex-1">{o.label}</span>
          {theme === o.value && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
        </MenuItem>
      ))}
    </>
  );
}

export function Topbar() {
  const { session } = usePermissions();
  const signOut = useSignOut();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const mac = useSyncExternalStore(
    () => () => undefined,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl sm:px-6">
      {/* Mobile navigation */}
      <D.Root open={navOpen} onOpenChange={setNavOpen}>
        <D.Trigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <MenuIcon />
          </Button>
        </D.Trigger>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-[oklch(0.1_0.03_268/0.55)] backdrop-blur-[3px]" />
          <D.Content className="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-border-strong bg-surface p-4 shadow-pop data-[state=open]:animate-fade-in">
            <D.Title className="sr-only">Navigation</D.Title>
            <D.Description className="sr-only">Main navigation</D.Description>
            <div className="mb-6 px-1">
              <Wordmark />
            </div>
            <SidebarNav onNavigate={() => setNavOpen(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="group flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-border bg-surface-sunken/70 px-3 text-[13px] text-subtle transition-colors hover:border-border-strong hover:text-muted"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <div className="ml-auto flex items-center gap-2">
        {session && (
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-surface-sunken sm:pr-3"
                aria-label="Account menu"
              >
                <Avatar name={session.user.displayName} seed={session.user.email} size={30} />
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block max-w-40 truncate text-[13px] font-medium">
                    {session.user.displayName}
                  </span>
                  <span className="block max-w-40 truncate text-[11px] text-subtle">
                    {session.user.email}
                  </span>
                </span>
              </button>
            </MenuTrigger>
            <MenuContent align="end">
              <div className="px-2.5 pb-2 pt-1.5">
                <p className="truncate text-[13px] font-medium">{session.user.displayName}</p>
                <p className="truncate text-[12px] text-subtle">{session.tenant.name}</p>
              </div>
              <MenuSeparator />
              <MenuItem asChild>
                <Link href="/account/security">
                  <ShieldCheck />
                  Security &amp; sign-in
                </Link>
              </MenuItem>
              <MenuSeparator />
              <ThemeMenuItems />
              <MenuSeparator />
              <MenuItem onSelect={() => void signOut()}>
                <LogOut />
                Sign out
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>
    </header>
  );
}
