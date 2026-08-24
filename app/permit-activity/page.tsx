import { redirect } from "next/navigation";

/** Stable global-nav entry point; neighborhood selection continues in the brief. */
export default function PermitActivityIndexPage() {
  redirect("/permit-activity/chatham");
}
