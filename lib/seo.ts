export const SITE_URL = normalizeSiteUrl(
  process.env.NEXT_PUBLIC_SITE_URL || "https://chicagoincentiveexplorer.com"
);

export const SITE_NAME = "Chicago Incentive Explorer";
export const DEFAULT_TITLE =
  "Chicago Incentive Explorer | Free Business Incentive Lookup by Address";
export const DEFAULT_DESCRIPTION =
  "Generate a free Chicago location snapshot by address. Explore TIF, NOF, SBIF, Enterprise Zones, vacancy signals, local support partners, and public incentive data.";

export const DEFAULT_KEYWORDS = [
  "Chicago business incentives",
  "Chicago Incentive Explorer",
  "Chicago incentives by address",
  "location snapshot",
  "TIF district",
  "Neighborhood Opportunity Fund",
  "NOF",
  "Opportunity Zone",
  "Enterprise Zone",
  "Chicago economic development",
  "small business grants",
  "SBIF",
  "incentive stacking",
  "Southeast Chicago business resources",
];

export const ORGANIZATION_NAME = "South East Chicago Chamber of Commerce";

export type SitemapFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export type PublicSeoRoute = {
  path: string;
  label: string;
  changeFrequency: SitemapFrequency;
  priority: number;
};

export const PUBLIC_SEO_ROUTES: PublicSeoRoute[] = [
  { path: "/", label: "Home", changeFrequency: "weekly", priority: 1 },
  { path: "/report", label: "Generate Report", changeFrequency: "weekly", priority: 0.95 },
  { path: "/map", label: "Explorer Map", changeFrequency: "weekly", priority: 0.9 },
  { path: "/programs", label: "Incentive Programs", changeFrequency: "weekly", priority: 0.9 },
  { path: "/qualify", label: "Pre-Qualify", changeFrequency: "monthly", priority: 0.75 },
  { path: "/locate", label: "Find Location by Sector", changeFrequency: "monthly", priority: 0.75 },
  { path: "/faq", label: "FAQ", changeFrequency: "monthly", priority: 0.7 },
  { path: "/quiz", label: "Chicago Incentive Quiz", changeFrequency: "monthly", priority: 0.6 },
];

export const PRIVATE_CRAWL_PATHS = [
  "/admin",
  "/admin/*",
  "/workspace",
  "/workspace/*",
  "/login",
  "/api",
  "/api/*",
  "/quiz/result",
  "/quiz/result?*",
  "/report?*",
  "/*?*",
];

export function normalizeSiteUrl(value: string): string {
  const withProtocol = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

export function absoluteUrl(path = "/"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalizedPath === "/" ? "/" : normalizedPath}`;
}

export function normalizePublicPath(pathname: string): string | null {
  const pathOnly = pathname.split(/[?#]/)[0] || "/";
  const normalized = pathOnly !== "/" ? pathOnly.replace(/\/+$/, "") : "/";

  return PUBLIC_SEO_ROUTES.some((route) => route.path === normalized) ? normalized : null;
}

export function buildSiteJsonLd() {
  const organizationId = `${SITE_URL}/#organization`;
  const websiteId = `${SITE_URL}/#website`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: SITE_NAME,
        parentOrganization: {
          "@type": "Organization",
          name: ORGANIZATION_NAME,
        },
        url: SITE_URL,
        telephone: "+17737211999",
        description:
          "A free public lookup tool helping Chicago businesses, property owners, and ecosystem partners identify incentive context and local support resources by address.",
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: SITE_NAME,
        url: SITE_URL,
        description: DEFAULT_DESCRIPTION,
        publisher: { "@id": organizationId },
        inLanguage: "en-US",
        potentialAction: {
          "@type": "SearchAction",
          target: `${SITE_URL}/report?addr={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

export function buildBreadcrumbJsonLd(pathname: string) {
  const normalizedPath = normalizePublicPath(pathname);
  if (!normalizedPath) return null;

  const route = PUBLIC_SEO_ROUTES.find((item) => item.path === normalizedPath);
  const itemListElement = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: absoluteUrl("/"),
    },
  ];

  if (route && normalizedPath !== "/") {
    itemListElement.push({
      "@type": "ListItem",
      position: 2,
      name: route.label,
      item: absoluteUrl(normalizedPath),
    });
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${absoluteUrl(normalizedPath)}#breadcrumb`,
    itemListElement,
  };
}
