import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Neural Frontier",
  description: "Neural Frontier SaaS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
