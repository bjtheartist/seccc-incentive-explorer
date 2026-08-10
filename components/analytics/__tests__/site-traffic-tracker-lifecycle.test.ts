import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const trackerSource = readFileSync(
  join(process.cwd(), "components/analytics/SiteTrafficTracker.tsx"),
  "utf8",
);
const layoutSource = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");

describe("SiteTrafficTracker navigation lifecycle", () => {
  it("retracks same-path query changes so explicit campaigns clear stale pilot state", () => {
    expect(trackerSource).toContain("useSearchParams()");
    expect(trackerSource).toContain("const search = searchParams.toString()");
    expect(trackerSource).toContain("readTrafficAttribution(searchQuery, document.referrer)");
    expect(trackerSource).toContain("}, [pathname, search]);");
  });

  it("keeps the root static shell behind the required search-params suspense boundary", () => {
    expect(layoutSource).toMatch(
      /<Suspense fallback=\{null\}>\s*<SiteTrafficTracker \/>\s*<\/Suspense>/,
    );
  });
});
