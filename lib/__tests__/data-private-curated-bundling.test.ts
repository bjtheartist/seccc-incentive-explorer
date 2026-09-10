import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * Guards the Vercel/Next production-bundling contract for `data/private/**`
 * and `data/curated/**`. `data/curated/**` is INCLUDED per file; `data/private/**`
 * is EXCLUDED wholesale and read through lib/private-data.ts instead (local file
 * in dev/tests/CI, private Vercel Blob in production) — see the two blocks at
 * the bottom. Same contract
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

  it("/api/owner-file/investment traces the funder HQ CSV", () => {
    expectRouteCovers("/api/owner-file/investment", "data/curated/foundation-hqs.csv");
  });

  it("/api/site-activity traces the site-activity directory", () => {
    expectRouteCovers("/api/site-activity", "data/curated/site-activity/index.csv");
  });

  /**
   * Three more request-time process.cwd() reads of server-only trees, found
   * while verifying the six above and identical in kind.
   */
  describe("the same defect elsewhere", () => {
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
   * No entry may fall back on a blanket `data/curated/**`. That tree holds 36MB
   * (investment-inputs/) and 26MB (zoning/) of files most routes never open; a
   * tree glob would push ~62MB of dead weight into every function that declared
   * it. `data/private/**` is covered by the stronger rule below: it may not be
   * traced AT ALL.
   */
  it("no route declares a blanket data/curated tree glob", () => {
    for (const [route, globs] of Object.entries(nextConfig.outputFileTracingIncludes ?? {})) {
      for (const glob of globs) {
        expect(glob, `${route} declares an oversized tree glob`).not.toBe("./data/curated/**");
      }
    }
  });
});

/**
 * The data/private side of the contract, INVERTED.
 *
 * Those five JSON files are ~48MB together (community-investment.json alone is
 * 42MB). Traced into every route that touched them, on every deployment, they
 * took this project's Vercel Functions Storage to 20GB — the bill this whole
 * change exists to stop.
 *
 * So the rule flipped: data/private is now EXCLUDED from tracing outright, and
 * lib/private-data.ts resolves each file from the local disk when it is there
 * (dev, tests, CI — the files are committed) and from a PRIVATE Vercel Blob when
 * it is not. Two-sided like the tests above: the config is pinned AND the real
 * readers are asserted to go through the new loader rather than back to
 * `readFileSync(process.cwd() + "data/private/…")`.
 */
describe("next.config.ts outputFileTracingExcludes — data/private stays OUT of the bundle", () => {
  it('excludes ./data/private/** for every route ("*")', () => {
    const excludes = nextConfig.outputFileTracingExcludes;
    expect(excludes, "outputFileTracingExcludes must be declared").toBeDefined();
    expect(excludes!["*"], 'the "*" key must exclude the private tree').toContain(
      "./data/private/**",
    );
  });

  it("no route re-includes anything under data/private", () => {
    for (const [route, globs] of Object.entries(nextConfig.outputFileTracingIncludes ?? {})) {
      for (const glob of globs) {
        expect(
          glob.startsWith("./data/private/"),
          `${route} re-traces ${glob} — data/private must never enter a function bundle`,
        ).toBe(false);
      }
    }
  });

  /**
   * The five loaders must read through lib/private-data.ts. A regression here
   * would be silent in dev and in CI (the files ARE on disk there) and would
   * only surface as a 48MB function bundle on the next deploy.
   */
  it.each([
    "lib/community-investment.ts",
    "lib/investment-analysis.ts",
    "lib/exemption-anomalies.ts",
    "lib/owner-cluster-geo.ts",
    "lib/tif-briefs.ts",
  ])("%s reads through lib/private-data.ts, not process.cwd()", (sourceFile) => {
    const source = sourceOf(sourceFile);
    expect(source).toMatch(/from "\.\/private-data"/);
    expect(source).not.toContain('readFileSync(path.join(process.cwd(), "data/private');
  });

  /**
   * The manifest is committed and is a pure function of the file contents, so
   * it must actually describe what is on disk — a stale entry means the
   * deployed function fetches a blob that is not the data this commit ships.
   */
  it("data/private-manifest.json matches the sha256 of every committed private JSON", () => {
    const manifestPath = path.join(REPO_ROOT, "data/private-manifest.json");
    expect(existsSync(manifestPath), "data/private-manifest.json is missing").toBe(true);
    const files = (
      JSON.parse(readFileSync(manifestPath, "utf8")) as {
        files: Record<string, { pathname: string; sha256: string; bytes: number }>;
      }
    ).files;

    const onDisk = readdirSync(path.join(REPO_ROOT, "data/private"))
      .filter((n) => n.endsWith(".json"))
      .sort();
    expect(Object.keys(files).sort()).toEqual(onDisk);

    for (const [filename, entry] of Object.entries(files)) {
      const body = readFileSync(path.join(REPO_ROOT, "data/private", filename));
      const sha256 = createHash("sha256").update(body).digest("hex");
      expect(entry.sha256, `${filename} sha256 is stale — re-run scripts/sync-private-data.mjs`).toBe(
        sha256,
      );
      expect(entry.bytes).toBe(body.byteLength);
      expect(entry.pathname).toBe(`private-data/${sha256.slice(0, 16)}/${filename}`);
    }
  });
});
