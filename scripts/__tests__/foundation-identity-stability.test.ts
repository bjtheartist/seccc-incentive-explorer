import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sol gate finding 2 (BLOCKER) — "The test does not append or insert rows; it
 * merely compares output against a map generated from the same ordering."
 *
 * scripts/foundation/test_identity_stability.py exercises the PURE identity
 * functions (assign_ordinals, node_fingerprint, stable_id,
 * select_amended_resolved_filings) directly against synthetic APPEND/INSERT
 * fixtures and an original-vs-amended supersession fixture — no network. It
 * DOES transitively import phase2_pipeline.py, though, which creates its XML/
 * funder cache directories at MODULE LOAD time under `PHASE2_STATE` (a
 * hard-coded macOS scratchpad path when unset) — harmless on the machine that
 * path was authored on, but a `PermissionError` on any other machine,
 * including a Linux CI runner where `/private` does not exist. PHASE2_STATE
 * is set here to a portable per-test tmp dir so this test runs identically
 * everywhere, never touching the real (macOS-only) default.
 */
describe("foundation identity stability (Sol gate finding 2)", () => {
  it("APPEND/INSERT/UNIQUENESS/SUPERSESSION assertions all pass", () => {
    const portableState = mkdtempSync(join(tmpdir(), "phase2-state-"));
    expect(() => {
      execFileSync("python3", ["scripts/foundation/test_identity_stability.py"], {
        cwd: process.cwd(),
        stdio: "pipe",
        env: { ...process.env, PHASE2_STATE: portableState },
      });
    }).not.toThrow();
  }, 30_000);
});
