import type { Metadata } from "next";
import { Servers } from "@/features/servers/servers";

export const metadata: Metadata = { title: "Servers" };

export default function Page() {
  return <Servers />;
}
