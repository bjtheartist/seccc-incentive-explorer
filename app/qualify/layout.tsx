import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Pre-Qualify for Chicago Incentives | Chicago Incentive Explorer",
  description:
    "Start a guided Chicago incentive check by address, project type, and readiness to understand which public programs may be worth verifying.",
  path: "/qualify",
  ogType: "website",
});

export default function QualifyLayout({ children }: { children: ReactNode }) {
  return children;
}
