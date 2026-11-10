import type { Metadata } from "next";
import { Exposure } from "@/features/servers/findings";

export const metadata: Metadata = { title: "Exposure" };

export default function Page() {
  return <Exposure />;
}
