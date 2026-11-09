import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Neural Frontier", template: "%s · Neural Frontier" },
  description: "One Intelligent Platform. Infinite Possibilities.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070b19" },
    { media: "(prefers-color-scheme: light)", color: "#f9fafc" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading the nonce makes every page dynamic, which per-request CSP nonces require.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
