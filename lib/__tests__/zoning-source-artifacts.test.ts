import { describe, expect, it } from "vitest";
import { loadZoningSourceLedger } from "@/lib/zoning-legislation-data";
import type { ZoningMapDelta } from "@/lib/zoning-legislation";

describe("committed zoning source artifacts", () => {
  const { legislation, mapSnapshot, mapDelta, zbaSnapshot, zbaDelta } =
    loadZoningSourceLedger();

  it("reconciles every eLMS search page and discloses related-record exclusions", () => {
    for (const search of legislation.coverage.searches) {
      expect(search.fetchedCount).toBe(search.publishedCount);
      expect(search.normalizedMatches + search.excludedRelatedRecords).toBe(
        search.publishedCount,
      );
    }
    expect(legislation.coverage.total).toBe(legislation.matters.length);
    expect(new Set(legislation.matters.map((matter) => matter.matterId)).size).toBe(
      legislation.matters.length,
    );
  });

  it("keeps pending matters distinct from adopted matters", () => {
    const lifecycleTotal = Object.values(legislation.coverage.byLifecycle).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(lifecycleTotal).toBe(legislation.coverage.total);
    expect(legislation.coverage.byLifecycle.pending).toBeGreaterThan(0);
    expect(legislation.coverage.byLifecycle.adopted).toBeGreaterThan(0);
    expect(
      legislation.matters.every(
        (matter) =>
          matter.lifecycle !== "adopted" ||
          matter.subStatus?.toLowerCase().includes("passed") === true,
      ),
    ).toBe(true);
  });

  it("stores map fingerprints rather than republishing inferred geometry", () => {
    expect(mapSnapshot.featureCount).toBe(mapSnapshot.records.length);
    expect(new Set(mapSnapshot.records.map((row) => row.globalId)).size).toBe(
      mapSnapshot.featureCount,
    );
    for (const row of mapSnapshot.records) {
      expect(row.attributeFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.geometryFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row).not.toHaveProperty("geometry");
      expect(row).not.toHaveProperty("permittedUse");
    }
  });

  // The rule this is meant to enforce — "a baseline must not invent changes" —
  // is a CONDITIONAL. It was written as an unconditional
  // `expect(mapDelta.comparedFrom).toBeNull()`, pinning the artifact to its
  // first-run state forever.
  //
  // That made the contract self-defeating. The daily workflow gates BOTH this
  // test and the "Open source-review PR" step on
  // `git diff --quiet -- data/curated/zoning`. The first time the City
  // actually reclassifies a parcel, the sync writes a delta carrying a real
  // `comparedFrom` and a non-empty `changes`, this assertion fails, the job
  // dies — and because the PR step shares the success condition, no review PR
  // is ever opened. The single event the feature exists to catch is the event
  // that would have silently killed the pipeline.
  //
  // Stated as an invariant, it holds today AND on the day a real change lands.
  it("never invents changes on a baseline, and stays self-consistent on a real comparison", () => {
    expect(mapDelta.comparedThrough).toBe(mapSnapshot.source.sourceUpdatedThrough);

    if (mapDelta.comparedFrom === null) {
      // No prior snapshot existed, so no change can honestly be claimed.
      expect(mapDelta.changes).toEqual([]);
      expect(mapDelta.counts).toEqual({
        added: 0,
        removed: 0,
        attributesChanged: 0,
        geometryChanged: 0,
        rekeyed: 0,
      });
    } else {
      // A comparison actually ran. Changes are allowed — and the published
      // counts must be a true tally of the list beneath them, so the headline
      // can never drift from the records it summarises.
      expect(typeof mapDelta.comparedFrom).toBe("string");
      const tally = {
        added: 0, removed: 0, attributesChanged: 0, geometryChanged: 0, rekeyed: 0,
      };
      for (const change of mapDelta.changes) {
        if (change.change === "added") tally.added += 1;
        else if (change.change === "removed") tally.removed += 1;
        else if (change.change === "attributes_changed") tally.attributesChanged += 1;
        else if (change.change === "geometry_changed") tally.geometryChanged += 1;
        // Independent dimension — see the contract test at the foot of this file.
        if (change.previousGlobalId != null) tally.rekeyed += 1;
      }
      expect(mapDelta.counts).toEqual(tally);
    }
  });

  it("stores every published ZBA record without republishing geometry", () => {
    expect(zbaSnapshot.featureCount).toBe(zbaSnapshot.records.length);
    expect(new Set(zbaSnapshot.records.map((row) => row.globalId)).size).toBe(
      zbaSnapshot.featureCount,
    );
    for (const row of zbaSnapshot.records) {
      expect(row.attributeFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row.geometryFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(row).not.toHaveProperty("geometry");
      expect(row).not.toHaveProperty("currentAuthorization");
    }
    expect(
      Object.values(zbaSnapshot.coverage.byCaseType).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(zbaSnapshot.featureCount);
    expect(zbaSnapshot.coverage.withoutPublishedJudgment).toBeGreaterThan(0);
  });

  // Same conditional shape as the map delta above, and for the same reason:
  // the ZBA layer will eventually gain or close a case, and the contract must
  // survive that instead of failing the workflow that is supposed to report it.
  it("does not invent ZBA freshness or changes, and stays self-consistent on a real comparison", () => {
    // The City genuinely publishes no updated-through date for this layer, so
    // this assertion is about the SOURCE, not about run order — it stays
    // unconditional on purpose.
    expect(zbaSnapshot.source.sourceUpdatedThrough).toBeNull();
    expect(zbaSnapshot.source.freshnessNote).toContain("does not publish");
    expect(zbaDelta.comparedThroughFeatureCount).toBe(zbaSnapshot.featureCount);

    if (zbaDelta.comparedFromFeatureCount === null) {
      expect(zbaDelta.changes).toEqual([]);
      expect(zbaDelta.counts).toEqual({
        added: 0,
        removed: 0,
        attributesChanged: 0,
        geometryChanged: 0,
      });
    } else {
      expect(typeof zbaDelta.comparedFromFeatureCount).toBe("number");
      const tally = { added: 0, removed: 0, attributesChanged: 0, geometryChanged: 0 };
      for (const change of zbaDelta.changes) {
        if (change.change === "added") tally.added += 1;
        else if (change.change === "removed") tally.removed += 1;
        else if (change.change === "attributes_changed") tally.attributesChanged += 1;
        else if (change.change === "geometry_changed") tally.geometryChanged += 1;
      }
      expect(zbaDelta.counts).toEqual(tally);
    }
  });
});

// ── The contract that the workflow depends on ────────────────────────────────
// These pin the two behaviours the audit found broken, independent of what the
// committed artifacts happen to contain today.

describe("delta contract survives a real change", () => {
  const baseline: ZoningMapDelta = {
    schemaVersion: 1,
    sourceUrl: "https://example.invalid/zoning",
    comparedFrom: null,
    comparedThrough: "2026-07-23T21:36:35.000Z",
    counts: { added: 0, removed: 0, attributesChanged: 0, geometryChanged: 0, rekeyed: 0 },
    changes: [],
  };

  const realComparison: ZoningMapDelta = {
    ...baseline,
    comparedFrom: "2026-07-23T21:36:35.000Z",
    counts: { added: 1, removed: 0, attributesChanged: 1, geometryChanged: 0, rekeyed: 1 },
    changes: [
      { globalId: "a", previousGlobalId: null, change: "added", before: null, after: null },
      // Re-keyed AND genuinely changed: it is reported under its real change,
      // and `previousGlobalId` is what makes the re-key countable.
      {
        globalId: "b",
        previousGlobalId: "b-was",
        change: "attributes_changed",
        before: null,
        after: null,
      },
    ],
  };

  /** The invariant the contract test enforces, extracted so both shapes hit it. */
  const assertDeltaHonest = (delta: ZoningMapDelta) => {
    if (delta.comparedFrom === null) {
      expect(delta.changes).toEqual([]);
      expect(delta.counts).toEqual({
        added: 0, removed: 0, attributesChanged: 0, geometryChanged: 0, rekeyed: 0,
      });
      return;
    }
    const tally = {
      added: 0, removed: 0, attributesChanged: 0, geometryChanged: 0, rekeyed: 0,
    };
    for (const c of delta.changes) {
      if (c.change === "added") tally.added += 1;
      else if (c.change === "removed") tally.removed += 1;
      else if (c.change === "attributes_changed") tally.attributesChanged += 1;
      else if (c.change === "geometry_changed") tally.geometryChanged += 1;
      // `rekeyed` is an INDEPENDENT dimension, not a fifth bucket. A record
      // whose id rotated and whose attributes also moved is reported under the
      // attribute change and still counted here — which is precisely what the
      // GLOBALID-keyed comparator could not do.
      if (c.previousGlobalId != null) tally.rekeyed += 1;
    }
    expect(delta.counts).toEqual(tally);
  };

  it("accepts the first-run baseline", () => {
    expect(() => assertDeltaHonest(baseline)).not.toThrow();
  });

  it("ACCEPTS a delta carrying real changes — the case that used to fail CI", () => {
    // Under the old `expect(comparedFrom).toBeNull()` this threw, the daily job
    // died, and the "Open source-review PR" step was skipped. The one event the
    // feature exists to report was the event that killed the pipeline.
    expect(() => assertDeltaHonest(realComparison)).not.toThrow();
  });

  it("still rejects a baseline that invented changes", () => {
    expect(() =>
      assertDeltaHonest({ ...baseline, changes: realComparison.changes }),
    ).toThrow();
  });

  it("rejects counts that disagree with the change list beneath them", () => {
    expect(() =>
      assertDeltaHonest({
        ...realComparison,
        counts: { added: 99, removed: 0, attributesChanged: 1, geometryChanged: 0, rekeyed: 1 },
      }),
    ).toThrow();
  });
});
