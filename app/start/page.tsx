import { Suspense } from "react";
import type { Metadata } from "next";
import { StartPageClient } from "@/components/start/StartPageClient";
import { absoluteUrl, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: {
    absolute: `Generate a Free Location Snapshot | ${SITE_NAME}`,
  },
  description:
    "Start with a Chicago address and generate a free location snapshot with incentive zones, TIF and NOF context, site signals, and local support organizations.",
  alternates: {
    canonical: absoluteUrl("/start"),
  },
  openGraph: {
    title: `Generate a Free Location Snapshot | ${SITE_NAME}`,
    description:
      "Start with a Chicago address and generate a free location snapshot with incentive zones, site context, and local support organizations.",
    url: absoluteUrl("/start"),
    siteName: SITE_NAME,
    type: "website",
  },
};

export default function StartPage() {
  return (
    <Suspense fallback={null}>
      <StartPageClient />
    </Suspense>
  );
}
