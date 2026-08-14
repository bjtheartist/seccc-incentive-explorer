import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Deliverable 1 — the generated README.md/REFRESH.md blocks (audit-scope claim
 * + foundation cadence table) must be regenerated FROM the manifest + fresh
 * audit report, never hand-edited. Same clean-diff contract as the manifest
 * gate itself.
 */
describe("investment docs clean-diff gate", () => {
  it("README.md/REFRESH.md GENERATED blocks match scripts/generate-investment-docs.ts's output", () => {
    expect(() => {
      execFileSync("npx", ["tsx", "scripts/generate-investment-docs.ts", "--check"], {
        cwd: process.cwd(),
        stdio: "pipe",
      });
    }).not.toThrow();
  }, 30_000);
});
