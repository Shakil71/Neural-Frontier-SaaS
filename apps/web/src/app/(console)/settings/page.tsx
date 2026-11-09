import type { Metadata } from "next";
import { Settings } from "@/features/settings/settings";

export const metadata: Metadata = { title: "Organisation" };

export default function Page() {
  return <Settings />;
}
