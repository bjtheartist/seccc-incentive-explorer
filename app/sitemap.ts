import type { MetadataRoute } from "next";
import { absoluteUrl, PUBLIC_SEO_ROUTES } from "@/lib/seo";
import { allProgramSlugs } from "@/lib/programs-data";
import { allNeighborhoodSlugs } from "@/lib/neighborhood-slugs";
import { allAnswerSlugs } from "@/lib/answers-data";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const staticRoutes: MetadataRoute.Sitemap = PUBLIC_SEO_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const programRoutes: MetadataRoute.Sitemap = allProgramSlugs().map((slug) => ({
    url: absoluteUrl(`/programs/${slug}`),
    lastModified,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  const neighborhoodRoutes: MetadataRoute.Sitemap = allNeighborhoodSlugs().map(
    (slug) => ({
      url: absoluteUrl(`/neighborhoods/${slug}/incentives`),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    }),
  );

  const answerRoutes: MetadataRoute.Sitemap = allAnswerSlugs().map((slug) => ({
    url: absoluteUrl(`/answers/${slug}`),
    lastModified,
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [
    ...staticRoutes,
    ...programRoutes,
    ...neighborhoodRoutes,
    ...answerRoutes,
  ];
}
