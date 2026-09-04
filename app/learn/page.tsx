import type { Metadata } from "next";

import LearningPathway from "@/components/learn/LearningPathway";
import { LEARNING_PATHWAY_STANDFIRST } from "@/lib/learning-pathway";

/**
 * /learn — the Learning Pathway.
 *
 * UNLISTED BY DECISION, not by accident. The page is reachable (a report's
 * zoning section links into it, and two quiet entries sit on /faq and
 * /programs), but it is deliberately kept out of every index: it is absent
 * from PUBLIC_SEO_ROUTES, so the sitemap never lists it; it appears in no
 * header or footer navigation; and the metadata below tells crawlers not to
 * index or follow it. Note it is NOT added to robots.txt's disallow list —
 * a Disallow would stop crawlers from ever reading this noindex, and would
 * publish the path in a file anyone can fetch.
 */
export const metadata: Metadata = {
  title: "Learning Pathway",
  description: LEARNING_PATHWAY_STANDFIRST,
  robots: { index: false, follow: false },
};

export default function LearnPage() {
  return <LearningPathway />;
}
