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
});
