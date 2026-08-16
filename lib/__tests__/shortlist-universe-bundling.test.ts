import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * Guards the Vercel/Next production-bundling contract for the Site
 * Shortlist universe files. `data/exports/shortlist-universe/*.json` lives
 * outside `public/` on purpose (server-only — see lib/shortlist-universe.ts
 * header), which means Next's build-time file tracing does NOT include it
 * by default: a `readFileSync` against a path outside public/ that isn't
 * reachable via static import analysis can work in `next dev` and 404 in
 * the deployed Vercel function. `outputFileTracingIncludes` is the fix, and
 * this test guards the config declaring it BEFORE PR2 wires the consumer —
 * exactly the failure mode the gpt5.6 matchmaker consult flagged (Q1: "the
 * current readFileSync convention does not guarantee new files outside
 * public/ are included... without tracing configuration").
 *
 * A full `next build` + inspection of the emitted `.next/server/**\/*.nft.json`
 * trace file is the strongest possible proof and was run manually as part
 * of this PR's verification (see the PR body); it is deliberately NOT run
 * inside this suite because a production build is too slow for the
 * standard `npm test` loop. This test is the fast, deterministic guard that
 * keeps the config from silently regressing.
 */
describe("next.config.ts outputFileTracingIncludes — shortlist universe bundling", () => {
  it("declares tracing for the shortlist route covering data/exports/shortlist-universe", () => {
    const includes = nextConfig.outputFileTracingIncludes;
    expect(includes).toBeDefined();
    const routeGlobs = includes!["/vacancy/[zip]/shortlist"];
    expect(routeGlobs).toBeDefined();
    expect(routeGlobs!.some((glob) => glob.includes("data/exports/shortlist-universe"))).toBe(true);
  });

  /**
   * The page's glob is recursive (`shortlist-universe/**`), so the
   * parcel-identity sidecars it reads for PIN provenance ride along with it.
   * Pinned explicitly because narrowing that glob to `*.json` would silently
   * strip the sidecars from the deployed page — no error, just every card
   * losing the precomputed PIN it should have had.
   */
  it("covers the parcel-identity sidecars for the shortlist page too", () => {
    const routeGlobs = nextConfig.outputFileTracingIncludes!["/vacancy/[zip]/shortlist"]!;
    expect(
      routeGlobs.some(
        (glob) =>
          glob.includes("data/exports/shortlist-universe/**") ||
          glob.includes("data/exports/shortlist-universe/parcel-identity"),
      ),
    ).toBe(true);
  });

  /**
   * app/api/shortlist/enrich/route.ts reads the parcel-identity manifest and
   * sidecars through `process.cwd()` — the same outside-public/,
   * not-statically-analyzable pattern the page needs tracing for — and it
   * needs its OWN entry, because tracing is declared per route. Without this
   * the deployed function finds no manifest, every PIN misses the precomputed
   * facts, and the route silently falls back to a per-PIN County ArcGIS call:
   * a pure performance regression with nothing to notice in the logs.
   */
  it("declares tracing for the enrich route covering the parcel-identity sidecars", () => {
    const routeGlobs = nextConfig.outputFileTracingIncludes!["/api/shortlist/enrich"];
    expect(routeGlobs).toBeDefined();
    expect(
      routeGlobs!.some((glob) => glob.includes("data/exports/shortlist-universe/parcel-identity")),
    ).toBe(true);
  });
});
