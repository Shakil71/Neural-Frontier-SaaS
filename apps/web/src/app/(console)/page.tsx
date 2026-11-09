import type { Metadata } from "next";
import { Overview } from "@/features/overview/overview";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return <Overview />;
}
