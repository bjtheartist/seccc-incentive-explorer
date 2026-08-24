import { redirect } from "next/navigation";

/** Orphan entry point: intentionally absent from the primary site navigation. */
export default function PermitActivityIndexPage() {
  redirect("/permit-activity/chatham");
}
