import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * Guards the Vercel/Next production-bundling contract for `data/private/**`
 * and `data/curated/**` — the same contract
 * lib/__tests__/shortlist-universe-bundling.test.ts guards for
 * `data/exports/**`, and the same one next.config.ts's own 20-line warning
 * comment was written about.
 *
 * The rule: a file read with `readFileSync(path.join(process.cwd(), …))` at
 * REQUEST time is invisible to Next's static import analysis, so unless the
 * consuming route is named in `outputFileTracingIncludes` the file is simply
 * absent from the deployed function. Every one of these loaders guards its
 * read with `existsSync` and returns null on a miss, which means the
 * production failure is silent: the surface renders "no data" and nothing is
 * logged. That is exactly what was happening — six readers had spread into
 * data/private/ and data/curated/ without anyone extending the map.
 *
 * These tests are deliberately two-sided. Pinning the config alone would rot
 * the moment a loader's path changed, so each case also reads the REAL
 * consuming source file and asserts it still names the path the config
 * declares, and that the file is actually on disk.
 */

const REPO_ROOT = path.join(__dirname, "..", "..");

function includesFor(route: string): string[] {
  const includes = nextConfig.outputFileTracingIncludes;
  expect(includes, "outputFileTracingIncludes must be declared").toBeDefined();
  const globs = includes![route];
  expect(globs, `no outputFileTracingIncludes entry for route ${route}`).toBeDefined();
  return globs!;
}

/** Assert `route`'s declared globs cover `dataPath` (exact file or a tree glob). */
function expectRouteCovers(route: string, dataPath: string): void {
  const globs = includesFor(route);
  const covered = globs.some(
    (glob) => glob === `./${dataPath}` || glob === `./${path.dirname(dataPath)}/**`,
  );
  expect(covered, `${route} does not trace ${dataPath} (declared: ${globs.join(", ")})`).toBe(true);
}

function sourceOf(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

describe("next.config.ts outputFileTracingIncludes — data/private + data/curated bundling", () => {
  describe("the REAL readers still read the paths the config declares", () => {
    it.each([
      ["lib/community-investment.ts", "data/private/community-investment.json"],
      ["lib/investment-analysis.ts", "data/private/capital-context.json"],
      ["lib/exemption-anomalies.ts", "data/private/exemption-anomalies.json"],
      ["app/api/owner-file/investment/route.ts", "data/curated/foundation-hqs.csv"],
    ])("%s reads %s through process.cwd()", (sourceFile, dataPath) => {
      const source = sourceOf(sourceFile);
      expect(source).toContain("process.cwd()");
      expect(source).toContain(dataPath);
      expect(
        existsSync(path.join(REPO_ROOT, dataPath)),
        `${dataPath} is missing from the repo`,
      ).toBe(true);
    });

    /** This one joins its segments, so it is matched on the segments. */
    it("app/api/site-activity/route.ts reads the data/curated/site-activity directory", () => {
      const source = sourceOf("app/api/site-activity/route.ts");
      expect(source).toContain("process.cwd()");
      expect(source).toContain(`"data", "curated", "site-activity"`);
      expect(existsSync(path.join(REPO_ROOT, "data/curated/site-activity"))).toBe(true);
    });
  });

  /**
   * The four Investment & Impact surfaces. `/investment` and
   * `/investment/[area]` are distinct route ids in Next's matcher, so a
   * `/investment/**` glob would leave the bare index page with no dataset at
   * all — each is asserted separately for exactly that reason.
   */
  it.each([
    "/investment",
    "/investment/[area]",
    "/investment/compare",
    "/print/investment/[area]",
  ])("%s traces both community-investment.json and capital-context.json", (route) => {
    expectRouteCovers(route, "data/private/community-investment.json");
    expectRouteCovers(route, "data/private/capital-context.json");
  });

  /**
   * The CORE report pathway. app/api/report/generate/route.ts calls
   * loadCapitalContextForArea() to resolve the FFIEC CRA series for the
   * report's community area; with the file untraced, the loader's existsSync
   * guard returns null in production and every generated report silently
   * loses its corridor-investment chart.
   */
  it("/api/report/generate traces capital-context.json", () => {
    expectRouteCovers("/api/report/generate", "data/private/capital-context.json");
    // The route must actually be the consumer this entry exists for.
    expect(sourceOf("app/api/report/generate/route.ts")).toContain("loadCapitalContextForArea");
  });

  /**
   * ...and must NOT drag the 42MB community-investment.json along with it.
   * The route reaches loadCapitalContextForArea and nothing else in
   * lib/investment-analysis.ts that opens that file, so tracing it here would
   * be 42MB of dead weight on the hottest function in the app, against
   * Vercel's 250MB uncompressed function ceiling. Pinned so a future
   * copy-paste of the /investment entry cannot quietly land here.
   */
  it("/api/report/generate does NOT trace the 42MB community-investment.json", () => {
    expect(includesFor("/api/report/generate")).not.toContain(
      "./data/private/community-investment.json",
    );
  });

  it("/api/owner-file/investment traces the dataset and the funder HQ CSV", () => {
    expectRouteCovers("/api/owner-file/investment", "data/private/community-investment.json");
    expectRouteCovers("/api/owner-file/investment", "data/curated/foundation-hqs.csv");
  });

  it("/vacancy/[zip]/report traces exemption-anomalies.json", () => {
    expectRouteCovers("/vacancy/[zip]/report", "data/private/exemption-anomalies.json");
    expect(sourceOf("app/vacancy/[zip]/report/page.tsx")).toContain("exemption-anomalies");
  });

  it("/api/site-activity traces the site-activity directory", () => {
    expectRouteCovers("/api/site-activity", "data/curated/site-activity/index.csv");
  });

  /**
   * Three more request-time process.cwd() reads of server-only trees, found
   * while verifying the six above and identical in kind.
   */
  describe("the same defect elsewhere", () => {
    it("/api/owner-file/geo traces owner-clusters-geo.json", () => {
      expectRouteCovers("/api/owner-file/geo", "data/private/owner-clusters-geo.json");
      expect(sourceOf("lib/owner-cluster-geo.ts")).toContain(
        "data/private/owner-clusters-geo.json",
      );
    });

    it("/admin/zoning-changes traces all five zoning ledger files", () => {
      for (const file of [
        "zoning-legislation.json",
        "zoning-map-snapshot.json",
        "zoning-map-latest-delta.json",
        "zoning-zba-snapshot.json",
        "zoning-zba-latest-delta.json",
      ]) {
        expectRouteCovers("/admin/zoning-changes", `data/curated/zoning/${file}`);
        expect(sourceOf("lib/zoning-legislation-data.ts")).toContain(file);
      }
    });

    /**
     * Only the three routes that actually call buildPermitExhibit read the
     * archive index; the other three permit-exhibit routes import the module
     * for label constants and never touch the filesystem.
     */
    it.each([
      "/permit-exhibit/[pin]",
      "/print/permit-exhibit/[pin]",
      "/api/permit-exhibit-snapshots",
    ])("%s traces the zoning archive index", (route) => {
      expectRouteCovers(route, "data/archive/zoning/index.json");
    });

    it("lib/permit-exhibit.ts still reads data/archive/zoning/index.json", () => {
      const source = sourceOf("lib/permit-exhibit.ts");
      expect(source).toContain(`["data", "archive", "zoning", "index.json"]`);
      expect(existsSync(path.join(REPO_ROOT, "data/archive/zoning/index.json"))).toBe(true);
    });
  });

  /**
   * No entry may fall back on a blanket `data/private/**` or
   * `data/curated/**`. Those trees hold 42MB (community-investment.json),
   * 36MB (investment-inputs/) and 26MB (zoning/) of files most routes never
   * open; a tree glob would push ~113MB of dead weight into every function
   * that declared it.
   */
  it("no route declares a blanket data/private or data/curated tree glob", () => {
    for (const [route, globs] of Object.entries(nextConfig.outputFileTracingIncludes ?? {})) {
      for (const glob of globs) {
        expect(glob, `${route} declares an oversized tree glob`).not.toBe("./data/private/**");
        expect(glob, `${route} declares an oversized tree glob`).not.toBe("./data/curated/**");
      }
    }
  });
});
