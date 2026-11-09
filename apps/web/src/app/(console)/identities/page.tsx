import type { Metadata } from "next";
import { Identities } from "@/features/identities/identities";

export const metadata: Metadata = { title: "Identities" };

export default function Page() {
  return <Identities />;
}
