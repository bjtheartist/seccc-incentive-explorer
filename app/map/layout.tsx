import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Chicago Incentive Map | Explore Zones by Address",
  description:
    "Explore Chicago incentive zones, vacancy signals, zoning, community assets, and local support context on an interactive map.",
  path: "/map",
  ogType: "website",
});

export default function MapLayout({ children }: { children: ReactNode }) {
  return children;
}
