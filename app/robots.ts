import type { MetadataRoute } from "next";
import { absoluteUrl, PRIVATE_CRAWL_PATHS, SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: PRIVATE_CRAWL_PATHS,
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
