import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * Guards the Vercel/Next production-bundling contract for
 * data/programs-internal.json, mirroring lib/__tests__/shortlist-universe-
 * bundling.test.ts's rationale exactly: a file living outside public/ is
 * server-only by construction, but Next's build-time file tracing does NOT
 * include it by default — a `readFileSync` against it can work in `next
 * dev` and silently 404 in the deployed Vercel function unless
 * `outputFileTracingIncludes` declares it. Declared now (PR1), even though
 * no PR1 route reads the file at request time yet — PR2 wires the actual
 * consumer routes (build-spec.md 1.2 / 2.2).
 */
describe("next.config.ts outputFileTracingIncludes — programs-internal catalog", () => {
  it("declares tracing for data/programs-internal.json on every route", () => {
    const includes = nextConfig.outputFileTracingIncludes;
    expect(includes).toBeDefined();
    const routeGlobs = includes!["/**"];
    expect(routeGlobs).toBeDefined();
    expect(routeGlobs).toContain("./data/programs-internal.json");
  });
});
