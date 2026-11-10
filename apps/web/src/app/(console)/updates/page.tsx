import type { Metadata } from "next";
import { Updates } from "@/features/servers/updates";

export const metadata: Metadata = { title: "Updates" };

export default function Page() {
  return <Updates />;
}
