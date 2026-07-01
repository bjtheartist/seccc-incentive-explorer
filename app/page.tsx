import type { Metadata } from "next";
import { HomePageClient } from "@/components/home/HomePageClient";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, SITE_URL } from "@/lib/seo";
import { getAllPrograms, programSlug } from "@/lib/programs-data";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { neighborhoodSlug } from "@/lib/neighborhood-slugs";
import { ANSWER_PAGES } from "@/lib/answers-data";
import { ZONE_LABELS } from "@/lib/constants";

export const metadata: Metadata = {
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  alternates: {
    canonical: SITE_URL,
  },
};

/** Demand-validated programs surfaced on the homepage (see growth research). */
const FEATURED_PROGRAM_IDS = [
  "sbif",
  "tif",
  "nof",
  "enterprise",
  "federalOZ",
  "ssa",
  "microMarketRecovery",
  "cpace",
];

/** Priority South/West-side community areas. */
const FEATURED_NEIGHBORHOODS = [
  "Auburn Gresham",
  "Englewood",
  "South Chicago",
  "North Lawndale",
  "South Shore",
  "Chatham",
  "Woodlawn",
  "Roseland",
];

const FEATURED_ANSWER_SLUGS = [
  "is-my-business-in-a-tif-district",
  "what-is-sbif-in-chicago",
  "what-grants-help-renovate-a-storefront-in-chicago",
  "how-do-i-check-chicago-business-incentives-by-address",
];

export default function Home() {
  const programs = getAllPrograms();
  const byId = new Map(programs.map((p) => [p.id, p]));

  const featuredPrograms = FEATURED_PROGRAM_IDS.flatMap((id) => {
    const p = byId.get(id);
    return p ? [{ name: p.name, slug: programSlug(p) }] : [];
  });

  const featuredNeighborhoods = FEATURED_NEIGHBORHOODS.flatMap((name) => {
    const ca = CHICAGO_COMMUNITY_AREAS.find((c) => c.name === name);
    return ca ? [{ name: ca.name, slug: neighborhoodSlug(ca) }] : [];
  });

  const featuredAnswers = FEATURED_ANSWER_SLUGS.flatMap((slug) => {
    const a = ANSWER_PAGES.find((ans) => ans.slug === slug);
    return a ? [{ question: a.question, slug: a.slug }] : [];
  });

  /** Ticker: every program name once (the marquee loops it). */
  const tickerNames = programs.map((p) => p.name);

  return (
    <HomePageClient
      stats={{
        programs: programs.length,
        neighborhoods: CHICAGO_COMMUNITY_AREAS.length,
        zoneLayers: Object.keys(ZONE_LABELS).length,
        answers: ANSWER_PAGES.length,
      }}
      featuredPrograms={featuredPrograms}
      featuredNeighborhoods={featuredNeighborhoods}
      featuredAnswers={featuredAnswers}
      tickerNames={tickerNames}
    />
  );
}
