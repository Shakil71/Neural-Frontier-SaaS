import type { Metadata } from "next";
import { SystemHealth } from "@/features/system/system";

export const metadata: Metadata = { title: "System health" };

export default function Page() {
  return <SystemHealth />;
}
