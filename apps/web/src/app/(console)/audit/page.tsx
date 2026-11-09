import type { Metadata } from "next";
import { AuditLog } from "@/features/audit/audit";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return <AuditLog />;
}
