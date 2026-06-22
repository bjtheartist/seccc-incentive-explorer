import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Generate a Free Chicago Location Snapshot | Incentive Report",
  description:
    "Generate a free address-based Chicago incentive report with location snapshot data, zoning context, TIF and NOF signals, local support partners, and next-step resources.",
  path: "/report",
  ogType: "website",
});

export default function ReportLayout({ children }: { children: ReactNode }) {
  return children;
}
