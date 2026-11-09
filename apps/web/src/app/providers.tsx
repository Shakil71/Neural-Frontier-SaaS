"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useState } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/overlays";
import { ApiRequestError } from "@/lib/api";

export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            // Never retry auth or permission failures; retry transient ones twice.
            retry: (count, err) =>
              !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) &&
              count < 2,
          },
        },
      }),
  );
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              className:
                "!rounded-lg !border !border-border-strong !bg-surface-raised !text-foreground !shadow-pop !font-sans",
            }}
          />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
