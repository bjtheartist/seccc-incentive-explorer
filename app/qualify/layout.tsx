import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Review Chicago Incentive Programs | Chicago Incentive Explorer",
  description:
    "Answer guided questions about your address and project to organize public incentive programs worth reviewing.",
  path: "/qualify",
  ogType: "website",
});

export default function QualifyLayout({ children }: { children: ReactNode }) {
  return children;
}
