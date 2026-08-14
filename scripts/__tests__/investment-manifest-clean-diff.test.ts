import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Deliverable 1 — "CI fails when regenerated docs differ from committed
 * (clean-diff gate)." Regenerates data/curated/investment-inputs/manifest.json
 * in `--check` mode (writes nothing, computes fresh content, diffs against the
 * committed bytes) and fails the suite on any drift — a stale contentHash, a
 * source added to the exporter but never authored into the manifest, or a
 * hand-edit of the committed JSON that the generator would not have produced.
 */
describe("investment manifest clean-diff gate", () => {
  it("data/curated/investment-inputs/manifest.json matches scripts/generate-investment-manifest.ts's output", () => {
    expect(() => {
      execFileSync("npx", ["tsx", "scripts/generate-investment-manifest.ts", "--check"], {
        cwd: process.cwd(),
        stdio: "pipe",
      });
    }).not.toThrow();
  }, 30_000);
});
