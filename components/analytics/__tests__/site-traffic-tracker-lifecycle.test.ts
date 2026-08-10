import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  explicitCampaignAttribution,
  shouldTrackSitePageView,
} from "../SiteTrafficTracker";

const trackerSource = readFileSync(
  join(process.cwd(), "components/analytics/SiteTrafficTracker.tsx"),
  "utf8",
);
const layoutSource = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");

describe("SiteTrafficTracker navigation lifecycle", () => {
  it("observes campaign changes without depending on arbitrary query churn", () => {
    expect(trackerSource).toContain("useSearchParams()");
    expect(trackerSource).toContain("const search = searchParams.toString()");
    expect(trackerSource).toContain("readTrafficAttribution(searchQuery, document.referrer)");
    expect(trackerSource).toContain("}, [pathname, campaign]);");
    expect(trackerSource).not.toContain("}, [pathname, search]);");
  });

  it("tracks path changes and introduced or changed campaigns only", () => {
    const report = { pathname: "/report", campaign: null };

    expect(shouldTrackSitePageView(null, report)).toBe(true);
    expect(shouldTrackSitePageView(report, report)).toBe(false);
    expect(
      shouldTrackSitePageView(report, {
        pathname: "/report",
        campaign: "validation-equipment",
      }),
    ).toBe(true);
    expect(
      shouldTrackSitePageView(
        { pathname: "/report", campaign: "validation-equipment" },
        { pathname: "/report", campaign: "validation-property" },
      ),
    ).toBe(true);
    expect(
      shouldTrackSitePageView(
        { pathname: "/report", campaign: "validation-equipment" },
        report,
      ),
    ).toBe(false);
    expect(
      shouldTrackSitePageView(report, { pathname: "/programs", campaign: null }),
    ).toBe(true);
  });

  it("normalizes the supported explicit campaign query keys", () => {
    expect(explicitCampaignAttribution("instant=true&lat=41.7")).toBeNull();
    expect(explicitCampaignAttribution("utm_campaign=summer+launch")).toBe(
      "summer launch",
    );
    expect(explicitCampaignAttribution("campaign=first&utm_campaign=second")).toBe(
      "first",
    );
    expect(explicitCampaignAttribution("c=short-code")).toBe("short-code");
  });

  it("keeps the root static shell behind the required search-params suspense boundary", () => {
    expect(layoutSource).toMatch(
      /<Suspense fallback=\{null\}>\s*<SiteTrafficTracker \/>\s*<\/Suspense>/,
    );
  });
});
