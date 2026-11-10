import { redirect } from "next/navigation";

/** Renamed in Phase 4b: the page now covers update findings too. */
export default function Page() {
  redirect("/findings");
}
