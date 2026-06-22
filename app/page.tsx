import type { Metadata } from "next";
import { HomePageClient } from "@/components/home/HomePageClient";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  alternates: {
    canonical: SITE_URL,
  },
};

export default function Home() {
  return <HomePageClient />;
}
