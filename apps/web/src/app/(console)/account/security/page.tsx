import type { Metadata } from "next";
import { AccountSecurity } from "@/features/account/security";

export const metadata: Metadata = { title: "Security & sign-in" };

export default function Page() {
  return <AccountSecurity />;
}
