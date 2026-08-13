import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Sol gate finding 4 (BLOCKER, round 2) — "the proving test only rechecks the
 * happy-path report. It would still pass if recipient matching were removed
 * because it never supplies an adversarial same-amount/wrong-recipient
 * fixture."
 *
 * scripts/foundation/test_prize_matching.py exercises match_prize_rows()
 * (extracted as a pure function from chicago_prize_census_check.py) against
 * two synthetic adversarial fixtures — no disk I/O, no dependency on the real
 * committed chicago_prize.csv/export data, so it fails loudly if recipient
 * matching or consumed-tracking is ever weakened:
 *   1. A same-amount, WRONG-recipient announcement row must come back
 *      unmatched (never a false positive on amount alone).
 *   2. Two announcement rows competing for ONE export record must leave
 *      exactly one matched — the second is blocked by consumed-tracking,
 *      never a double-match.
 */
describe("Chicago Prize adversarial matching fixtures (Sol gate finding 4)", () => {
  it("wrong-recipient and competing-rows fixtures both behave correctly", () => {
    expect(() => {
      execFileSync("python3", ["scripts/foundation/test_prize_matching.py"], {
        cwd: process.cwd(),
        stdio: "pipe",
      });
    }).not.toThrow();
  }, 30_000);
});
