import type { Metadata } from "next";
import { Connectors } from "@/features/connectors/connectors";

export const metadata: Metadata = { title: "Connectors" };

export default function Page() {
  return <Connectors />;
}
