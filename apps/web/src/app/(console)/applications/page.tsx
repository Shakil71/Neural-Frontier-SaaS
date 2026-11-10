import type { Metadata } from "next";
import { Applications } from "@/features/applications/applications";

export const metadata: Metadata = { title: "Applications" };

export default function Page() {
  return <Applications />;
}
