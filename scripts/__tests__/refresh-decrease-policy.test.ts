import { describe, expect, it } from "vitest";
import { buildRefreshAttemptArtifact, checkDecreasePolicy, type Outcome } from "../refresh/refresh-live-sources";

/**
 * Sol gate finding 7 (BLOCKER) — "the manifest's decrease policies are never
 * imported or enforced. Refresh still writes after measuring... does not
 * compare declared dollar value fields." Tests the manifest-driven
 * checkDecreasePolicy() directly: prohibited decreases, allowed churn, exact
 * pins, and the not_refreshed exemption (chicago-cares' known upstream-
 * timestamp churn).
 */
describe("refresh decrease-policy enforcement (Sol gate finding 7)", () => {
  it("monotonic_floor (hud): a small decrease (<=2%) is ALLOWED CHURN", () => {
    // hud: 6,082 -> 6,050 is a 0.53% drop.
    const result = checkDecreasePolicy("hud", { rows: 6082, dollars: 1_000_000, parts: {} }, { rows: 6050, dollars: 1_000_000, parts: {} });
    expect(result.allowed).toBe(true);
  });

  it("monotonic_floor (hud): a decrease over 2% is a PROHIBITED DECREASE", () => {
    // 6,082 -> 5,000 is a 17.8% drop -- exceeds the floor.
    const result = checkDecreasePolicy("hud", { rows: 6082, dollars: 1_000_000, parts: {} }, { rows: 5000, dollars: 1_000_000, parts: {} });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/monotonic_floor/);
  });

  it("monotonic_floor: the DECLARED VALUE FIELD (dollars) is checked too, not just rows", () => {
    // Rows unchanged, but dollars drop 10% -- still prohibited.
    const result = checkDecreasePolicy("hud", { rows: 6082, dollars: 1_000_000, parts: {} }, { rows: 6082, dollars: 900_000, parts: {} });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/dollars/);
  });

  it("exact_pin (foundation-base): ANY decrease is a PROHIBITED DECREASE, even 1 row", () => {
    const result = checkDecreasePolicy(
      "foundation-base",
      { rows: 9821, dollars: 500_000_000, parts: {} },
      { rows: 9820, dollars: 500_000_000, parts: {} },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/exact_pin/);
  });

  it("growth or unchanged is ALWAYS allowed, under every policy", () => {
    expect(checkDecreasePolicy("foundation-base", { rows: 100, dollars: 100, parts: {} }, { rows: 101, dollars: 100, parts: {} }).allowed).toBe(true);
    expect(checkDecreasePolicy("hud", { rows: 100, dollars: 100, parts: {} }, { rows: 100, dollars: 100, parts: {} }).allowed).toBe(true);
  });

  it("not_refreshed (chicago-cares): the guard is EXEMPT by design, even on a large decrease", () => {
    // chicago-cares' ledger legitimately churns on the upstream publish
    // timestamp (see REFRESH.md) -- a raw row-count/dollar drop is not itself
    // meaningful for this source.
    const result = checkDecreasePolicy("chicago-cares", { rows: 100, dollars: 1_000_000, parts: {} }, { rows: 10, dollars: 100, parts: {} });
    expect(result.allowed).toBe(true);
  });

  it("an id absent from the manifest defaults to monotonic_floor (never silently unguarded)", () => {
    const result = checkDecreasePolicy("some-unknown-source-id", { rows: 100, dollars: 100, parts: {} }, { rows: 50, dollars: 100, parts: {} });
    expect(result.allowed).toBe(false);
  });

  it("missing before/after metrics never throws — treated as allowed (nothing to compare)", () => {
    expect(checkDecreasePolicy("hud", null, { rows: 10, dollars: 10, parts: {} }).allowed).toBe(true);
    expect(checkDecreasePolicy("hud", { rows: 10, dollars: 10, parts: {} }, null).allowed).toBe(true);
  });
});

describe("refresh-attempt.json failure artifact (Sol gate finding 7)", () => {
  const okOutcome: Outcome = {
    id: "nof-small",
    label: "NOF Small",
    file: "nof_small.json",
    dollarLabel: "incentive_amount",
    ok: true,
    changed: true,
    before: { rows: 10, dollars: 100, parts: {} },
    after: { rows: 11, dollars: 110, parts: {} },
  };
  const failedOutcome: Outcome = {
    id: "hud",
    label: "HUD CDBG/HOME",
    file: "hud_cpd_activities.csv",
    dollarLabel: "funding_amount",
    ok: false,
    changed: false,
    before: { rows: 6082, dollars: 1_000_000, parts: {} },
    after: null,
    error: "ArcGIS request timed out",
  };

  it("a run with at least one failure PRODUCES an artifact naming the failed source(s)", () => {
    const artifact = buildRefreshAttemptArtifact([okOutcome, failedOutcome]);
    expect(artifact).not.toBeNull();
    expect(artifact!.failedSources.map((f) => f.id)).toEqual(["hud"]);
    expect(artifact!.failedSources[0].error).toBe("ArcGIS request timed out");
    expect(artifact!.okSources).toEqual(["nof-small"]);
    expect(typeof artifact!.attemptedAt).toBe("string");
  });

  it("an all-healthy run PRODUCES NO artifact (main() removes any stale one)", () => {
    expect(buildRefreshAttemptArtifact([okOutcome])).toBeNull();
    expect(buildRefreshAttemptArtifact([])).toBeNull();
  });
});
