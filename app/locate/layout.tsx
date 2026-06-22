import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Find Chicago Locations by Sector | Chicago Incentive Explorer",
  description:
    "Explore Chicago location context by sector, including incentive zones, local assets, logistics access, vacancy signals, and neighborhood market context.",
  path: "/locate",
  ogType: "website",
});

export default function LocateLayout({ children }: { children: ReactNode }) {
  return children;
}
