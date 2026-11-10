import type { Metadata } from "next";
import { Exposure } from "@/features/servers/findings";

export const metadata: Metadata = { title: "Security findings" };

export default function Page() {
  return <Exposure />;
}
