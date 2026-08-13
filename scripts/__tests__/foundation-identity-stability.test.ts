import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Sol gate finding 2 (BLOCKER) — "The test does not append or insert rows; it
 * merely compares output against a map generated from the same ordering."
 *
 * scripts/foundation/test_identity_stability.py exercises the PURE identity
 * functions (assign_ordinals, node_fingerprint, stable_id,
 * select_amended_resolved_filings) directly against synthetic APPEND/INSERT
 * fixtures and an original-vs-amended supersession fixture — no disk I/O, no
 * network, so it runs in CI exactly like it runs here.
 */
describe("foundation identity stability (Sol gate finding 2)", () => {
  it("APPEND/INSERT/UNIQUENESS/SUPERSESSION assertions all pass", () => {
    expect(() => {
      execFileSync("python3", ["scripts/foundation/test_identity_stability.py"], {
        cwd: process.cwd(),
        stdio: "pipe",
      });
    }).not.toThrow();
  }, 30_000);
});
