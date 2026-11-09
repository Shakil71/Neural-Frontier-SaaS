"use client";

import { CornerDownLeft, LogOut, Moon, Search, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Dialog as D } from "radix-ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Kbd } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { usePermissions, useSignOut } from "@/lib/session";
import { NAV } from "./navigation";

interface Command {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  keywords: string;
  run: () => void;
}

/** ⌘K / Ctrl+K: jump anywhere, switch theme, sign out. Every entry performs a real action. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const { can } = usePermissions();
  const { resolvedTheme, setTheme } = useTheme();
  const signOut = useSignOut();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const commands = useMemo<Command[]>(() => {
    const go = NAV.flatMap(({ items }) =>
      items
        .filter((i) => can(i.permission))
        .map((i) => ({
          id: `go:${i.href}`,
          label: i.label,
          group: "Go to",
          icon: <i.icon />,
          keywords: `${i.label} ${i.keywords ?? ""}`,
          run: () => router.push(i.href),
        })),
    );
    const dark = resolvedTheme === "dark";
    return [
      ...go,
      {
        id: "theme",
        label: dark ? "Switch to light theme" : "Switch to dark theme",
        group: "Preferences",
        icon: dark ? <Sun /> : <Moon />,
        keywords: "theme dark light appearance",
        run: () => setTheme(dark ? "light" : "dark"),
      },
      {
        id: "signout",
        label: "Sign out",
        group: "Account",
        icon: <LogOut />,
        keywords: "logout sign out exit",
        run: () => void signOut(),
      },
    ];
  }, [can, resolvedTheme, router, setTheme, signOut]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? commands.filter(
          (c) => c.keywords.toLowerCase().includes(q) || c.label.toLowerCase().includes(q),
        )
      : commands;
  }, [commands, query]);

  // Clamp rather than reset in an effect: the list shrinks as the query narrows.
  const active = Math.min(index, Math.max(results.length - 1, 0));

  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    setQuery("");
    c.run();
  };

  let lastGroup = "";
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[oklch(0.1_0.03_268/0.55)] backdrop-blur-[3px] data-[state=open]:animate-fade-in" />
        <D.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-surface-raised shadow-pop data-[state=open]:animate-fade-in">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Search pages and actions</D.Description>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-4 text-subtle" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndex((i) => Math.min(i + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  run(results[active]);
                }
              }}
              placeholder="Search pages and actions…"
              aria-label="Search pages and actions"
              role="combobox"
              aria-expanded
              aria-controls="command-results"
              aria-activedescendant={results[active] ? `cmd-${results[active]!.id}` : undefined}
              className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
            />
            <Kbd>Esc</Kbd>
          </div>
          <ul
            id="command-results"
            role="listbox"
            className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2"
          >
            {results.length === 0 && (
              <li className="px-3 py-8 text-center text-[13px] text-muted">
                No matches for “{query}”
              </li>
            )}
            {results.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <li key={c.id} role="presentation">
                  {header && (
                    <p className="px-3 pb-1.5 pt-3 text-[10.5px] font-medium uppercase tracking-[0.14em] text-subtle">
                      {header}
                    </p>
                  )}
                  <div
                    id={`cmd-${c.id}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setIndex(i)}
                    onClick={() => run(c)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] [&_svg]:size-4",
                      i === active
                        ? "bg-primary-soft text-foreground [&_svg]:text-primary"
                        : "text-muted [&_svg]:text-subtle",
                    )}
                  >
                    {c.icon}
                    <span className="flex-1">{c.label}</span>
                    {i === active && (
                      <CornerDownLeft className="!size-3.5 !text-subtle" aria-hidden />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
