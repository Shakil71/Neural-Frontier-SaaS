import type { Metadata } from "next";
import { ServicePrincipals } from "@/features/service-principals/service-principals";

export const metadata: Metadata = { title: "Service principals" };

export default function Page() {
  return <ServicePrincipals />;
}
