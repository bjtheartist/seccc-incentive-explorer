import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Chicago Incentive Explorer FAQ | Incentives by Address",
  description:
    "Answers to common questions about using Chicago Incentive Explorer, interpreting location snapshots, and verifying public incentive programs.",
  path: "/faq",
  ogType: "website",
});

export default function FaqLayout({ children }: { children: ReactNode }) {
  return children;
}
