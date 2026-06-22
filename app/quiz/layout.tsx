import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Chicago Incentive Quiz | Learn Public Incentive Basics",
  description:
    "Test your knowledge of Chicago business incentives, public programs, zone-based eligibility, and small business support resources.",
  path: "/quiz",
  ogType: "website",
});

export default function QuizLayout({ children }: { children: ReactNode }) {
  return children;
}
