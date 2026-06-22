import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Chicago Incentive Programs | Grants, Tax Credits, and Financing",
  description:
    "Browse Chicago incentive programs across federal, state, county, city, and utility sources, including TIF, NOF, SBIF, Enterprise Zones, and Cook County programs.",
  path: "/programs",
  ogType: "website",
});

export default function ProgramsLayout({ children }: { children: ReactNode }) {
  return children;
}
