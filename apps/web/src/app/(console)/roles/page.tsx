import type { Metadata } from "next";
import { Roles } from "@/features/roles/roles";

export const metadata: Metadata = { title: "Roles & access" };

export default function Page() {
  return <Roles />;
}
