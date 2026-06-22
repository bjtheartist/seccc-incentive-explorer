import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  buildBreadcrumbJsonLd,
  pageMetadata,
  buildSiteJsonLd,
  normalizePublicPath,
  normalizeSiteUrl,
  PRIVATE_CRAWL_PATHS,
  PUBLIC_SEO_ROUTES,
} from "@/lib/seo";

describe("seo helpers", () => {
  it("normalizes canonical site URLs", () => {
    expect(normalizeSiteUrl("chicagoincentiveexplorer.com/")).toBe(
      "https://chicagoincentiveexplorer.com"
    );
    expect(normalizeSiteUrl("https://example.com///")).toBe("https://example.com");
  });

  it("keeps sitemap routes public, static, and unparameterized", () => {
    expect(PUBLIC_SEO_ROUTES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/" }),
        expect.objectContaining({ path: "/report" }),
        expect.objectContaining({ path: "/programs" }),
      ])
    );

    for (const route of PUBLIC_SEO_ROUTES) {
      expect(route.path).toMatch(/^\//);
      expect(route.path).not.toContain("?");
      expect(route.path).not.toContain("[");
      expect(route.path).not.toMatch(/^\/(?:admin|workspace|login|api)(?:\/|$)/);
      expect(route.path).not.toBe("/check");
      expect(route.path).not.toBe("/quiz/result");
    }
  });

  it("blocks private and parameterized crawl targets", () => {
    expect(PRIVATE_CRAWL_PATHS).toEqual(
      expect.arrayContaining(["/admin/*", "/workspace/*", "/api/*", "/report?*", "/*?*"])
    );
  });

  it("builds absolute sitemap and breadcrumb URLs from the production canonical host", () => {
    expect(absoluteUrl("/map")).toBe("https://chicagoincentiveexplorer.com/map");

    expect(buildSiteJsonLd()).toMatchObject({
      "@graph": expect.arrayContaining([
        expect.objectContaining({
          "@type": "WebSite",
          potentialAction: expect.objectContaining({
            "@type": "SearchAction",
            target: "https://chicagoincentiveexplorer.com/report?addr={search_term_string}",
          }),
        }),
      ]),
    });

    const breadcrumbs = buildBreadcrumbJsonLd("/programs");
    expect(breadcrumbs).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        expect.objectContaining({ position: 1, item: "https://chicagoincentiveexplorer.com/" }),
        expect.objectContaining({
          position: 2,
          name: "Incentive Programs",
          item: "https://chicagoincentiveexplorer.com/programs",
        }),
      ],
    });
  });

  it("only emits breadcrumbs for public static routes", () => {
    expect(normalizePublicPath("/report?wv=2&rt=df")).toBe("/report");
    expect(buildBreadcrumbJsonLd("/admin/analytics")).toBeNull();
    expect(buildBreadcrumbJsonLd("/workspace/reports/123")).toBeNull();
    expect(buildBreadcrumbJsonLd("/quiz/result?score=8")).toBeNull();
  });

  it("builds route metadata with page-specific canonical and Open Graph URLs", () => {
    expect(
      pageMetadata({
        title: "Incentive Programs",
        description: "Browse Chicago incentive programs.",
        path: "/programs",
        ogType: "website",
      })
    ).toMatchObject({
      alternates: { canonical: "https://chicagoincentiveexplorer.com/programs" },
      openGraph: {
        url: "https://chicagoincentiveexplorer.com/programs",
        type: "website",
      },
    });
  });
});
