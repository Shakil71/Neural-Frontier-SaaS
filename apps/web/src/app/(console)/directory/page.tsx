import type { Metadata } from "next";
import { Directory } from "@/features/directory/directory";

export const metadata: Metadata = { title: "Directory" };

export default function Page() {
  return <Directory />;
}
