import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetShortlistParcelIdentityCacheForTests,
  __setShortlistParcelIdentityDataDirForTests,
  applyPrecomputedParcelIdentity,
  loadPrecomputedCountyParcelFacts,
  loadShortlistParcelIdentity,
  loadShortlistParcelIdentityEntries,
  type ResolvedShortlistParcelIdentity,
} from "../shortlist-parcel-identity";
import type { CandidateOverlays, DecoratedShortlistCandidate } from "../shortlist-engine";

/**
 * The parcel-identity sidecar is the one place a shortlist card can acquire a
 * PIN it never published. Every test here is about the same question: can a
 * stale, tampered, half-written, or wrong-universe sidecar put a WRONG PIN on
 * a record? The answer must be no in every case, and the fallback must be the
 * empty map (today's on-demand behavior), never a throw.
 */

const BUILD_ID = "shortlist-universe-test-build";
const CHECKED_AT = "2026-08-16T03:58:31.254Z";

let dir: string;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface WriteOptions {
  zip?: string;
  manifestBuildId?: string;
  fileBuildId?: string;
  /** Corrupt the manifest checksum so it cannot match the file on disk. */
  breakChecksum?: boolean;
  /** Publish a different entryCount than the file actually carries. */
  entryCount?: number;
  entries?: Record<string, unknown>;
  factsByPin?: Record<string, unknown>;
  /** Additive fields a future precompute run may write (must be tolerated). */
  extraFileFields?: Record<string, unknown>;
  /** Merge this ZIP into the manifest instead of replacing it. */
  appendToManifest?: boolean;
}

function facts(overrides: Record<string, unknown> = {}) {
  return {
    countyClass: "517",
    lotAreaSqft: 3125,
    assessorBuildingSqft: 1800,
    assessorBuildingYear: "2025",
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

function writeSidecar(options: WriteOptions = {}): void {
  const zip = options.zip ?? "60619";
  const entries = options.entries ?? {
    "site:aaa": { status: "resolved", pin: "25023160330000", countyAddress: "9324 S UNIVERSITY AVE", checkedAt: CHECKED_AT },
    "site:bbb": { status: "no_match", reason: "no_intersection", checkedAt: CHECKED_AT },
    "site:ccc": { status: "ambiguous", candidateCount: 3, checkedAt: CHECKED_AT },
  };
  const file = {
    schemaVersion: 1,
    zip,
    universeBuildId: options.fileBuildId ?? BUILD_ID,
    generatedAt: CHECKED_AT,
    source: "cook_county_current_parcels",
    matchMethod: "exact_intersection",
    counts: { candidates: 3, resolved: 1, noIntersection: 1, ambiguous: 1, addressMismatch: 0, skippedInvalidLocation: 0 },
    entries,
    ...(options.factsByPin ? { factsByPin: options.factsByPin } : {}),
    ...(options.extraFileFields ?? {}),
  };
  const serialized = JSON.stringify(file, null, 1) + "\n";
  writeFileSync(join(dir, `${zip}.json`), serialized);

  const manifestPath = join(dir, "manifest.json");
  const existingFiles =
    options.appendToManifest && existsSync(manifestPath)
      ? ((JSON.parse(readFileSync(manifestPath, "utf8")) as { files: Record<string, unknown> }).files ?? {})
      : {};
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        universeBuildId: options.manifestBuildId ?? BUILD_ID,
        generatedAt: CHECKED_AT,
        files: {
          ...existingFiles,
          [zip]: {
            path: `${zip}.json`,
            checksum: options.breakChecksum ? sha256(`${serialized}tampered`) : sha256(serialized),
            entryCount: options.entryCount ?? Object.keys(entries).length,
          },
        },
      },
      null,
      2,
    ) + "\n",
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "parcel-identity-"));
  __setShortlistParcelIdentityDataDirForTests(dir);
  __resetShortlistParcelIdentityCacheForTests();
});

afterEach(() => {
  __setShortlistParcelIdentityDataDirForTests(null);
  __resetShortlistParcelIdentityCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe("loadShortlistParcelIdentity", () => {
  it("returns only the resolved entries, PIN-normalized, for a matching build", () => {
    writeSidecar();
    const byKey = loadShortlistParcelIdentity("60619", BUILD_ID);
    expect([...byKey.keys()]).toEqual(["site:aaa"]);
    expect(byKey.get("site:aaa")).toEqual({
      status: "resolved",
      pin: "25023160330000",
      countyAddress: "9324 S UNIVERSITY AVE",
      checkedAt: CHECKED_AT,
    });
  });

  it("keeps the misses available separately, so a gap can be explained without a County call", () => {
    writeSidecar();
    const entries = loadShortlistParcelIdentityEntries("60619", BUILD_ID);
    expect(entries.size).toBe(3);
    expect(entries.get("site:bbb")).toMatchObject({ status: "no_match", reason: "no_intersection" });
    expect(entries.get("site:ccc")).toMatchObject({ status: "ambiguous", candidateCount: 3 });
  });

  it("fails closed to an empty map when the sidecar was built against a different universe", () => {
    writeSidecar({ manifestBuildId: "other-build", fileBuildId: "other-build" });
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(0);
  });

  it("fails closed when the per-ZIP file's own buildId drifts from the manifest's", () => {
    // Manifest claims the current build; the file inside was written for
    // another one — a half-regenerated set, never merged.
    const stale = { schemaVersion: 1, zip: "60619", universeBuildId: "older-build", generatedAt: CHECKED_AT, source: "cook_county_current_parcels", matchMethod: "exact_intersection", entries: { "site:aaa": { status: "resolved", pin: "25023160330000", countyAddress: "X", checkedAt: CHECKED_AT } } };
    const serialized = JSON.stringify(stale, null, 1) + "\n";
    writeFileSync(join(dir, "60619.json"), serialized);
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, universeBuildId: BUILD_ID, generatedAt: CHECKED_AT, files: { "60619": { path: "60619.json", checksum: sha256(serialized), entryCount: 1 } } }),
    );
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(0);
  });

  it("fails closed when the file checksum does not match the manifest", () => {
    writeSidecar({ breakChecksum: true });
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(0);
  });

  it("fails closed when the manifest's entry count disagrees with the file", () => {
    writeSidecar({ entryCount: 99 });
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(0);
  });

  it("drops a resolved entry whose PIN is not a real 14-digit PIN, keeping the rest", () => {
    writeSidecar({
      entries: {
        "site:good": { status: "resolved", pin: "25-02-316-033-0000", countyAddress: "A", checkedAt: CHECKED_AT },
        "site:bad": { status: "resolved", pin: "123", countyAddress: "B", checkedAt: CHECKED_AT },
      },
    });
    const byKey = loadShortlistParcelIdentity("60619", BUILD_ID);
    expect([...byKey.keys()]).toEqual(["site:good"]);
    expect(byKey.get("site:good")?.pin).toBe("25023160330000");
  });

  it("fails closed on a schema violation (a checkedAt that is not a full ISO instant)", () => {
    writeSidecar({
      entries: { "site:aaa": { status: "resolved", pin: "25023160330000", countyAddress: "A", checkedAt: "2026-08-16" } },
    });
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(0);
  });

  it("fails closed on an impossible instant that merely LOOKS like an ISO timestamp", () => {
    // A shape-only regex accepts this; the round-trip check the live
    // resolver uses is what actually rejects it.
    writeSidecar({
      entries: {
        "site:aaa": {
          status: "resolved",
          pin: "25023160330000",
          countyAddress: "A",
          checkedAt: "2026-13-45T99:99:99.999Z",
        },
      },
    });
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(0);
  });

  it("fails closed on an impossible instant inside the FACTS block too", () => {
    writeSidecar({ factsByPin: { "25023160330000": facts({ checkedAt: "2026-02-30T12:00:00.000Z" }) } });
    expect(loadPrecomputedCountyParcelFacts(BUILD_ID).size).toBe(0);
    // …without taking the identities down with it.
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(1);
  });

  it("returns an empty map (never throws) when the directory has no manifest at all", () => {
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(0);
    expect(loadShortlistParcelIdentity("00000", BUILD_ID).size).toBe(0);
  });

  it("returns an empty map for a ZIP the manifest does not list", () => {
    writeSidecar();
    expect(loadShortlistParcelIdentity("60623", BUILD_ID).size).toBe(0);
  });

  it("tolerates additive fields a newer precompute run may write", () => {
    writeSidecar({
      extraFileFields: {
        factsByPin: {
          "25023160330000": { countyClass: "100", lotAreaSqft: 3125, assessorBuildingSqft: null, assessorBuildingYear: null, checkedAt: CHECKED_AT },
        },
        counts: { candidates: 3, resolved: 1, noIntersection: 1, ambiguous: 1, addressMismatch: 0, skippedInvalidLocation: 0, someFutureCount: 7 },
      },
    });
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(1);
  });
});

describe("loadPrecomputedCountyParcelFacts", () => {
  it("merges factsByPin across every ZIP in the manifest, normalizing pins and null-holes", () => {
    writeSidecar({
      zip: "60619",
      factsByPin: {
        "25023160330000": facts(),
        "25024110270000": facts({ countyClass: "100", assessorBuildingSqft: null, assessorBuildingYear: null }),
      },
    });
    writeSidecar({
      zip: "60623",
      appendToManifest: true,
      factsByPin: { "16-26-427-040-0000": facts({ countyClass: "211", lotAreaSqft: 4000 }) },
    });

    const byPin = loadPrecomputedCountyParcelFacts(BUILD_ID);
    expect(byPin.size).toBe(3);
    expect(byPin.get("25023160330000")).toEqual({
      countyClass: "517",
      lotAreaSqft: 3125,
      assessorBuildingSqft: 1800,
      assessorBuildingYear: "2025",
      checkedAt: CHECKED_AT,
    });
    expect(byPin.get("25024110270000")).toMatchObject({
      countyClass: "100",
      assessorBuildingSqft: null,
      assessorBuildingYear: null,
    });
    // A dashed key in the file still answers a normalized 14-digit lookup.
    expect(byPin.get("16264270400000")?.countyClass).toBe("211");
  });

  it("returns an empty map for a buildId the manifest was not built against", () => {
    writeSidecar({ factsByPin: { "25023160330000": facts() } });
    expect(loadPrecomputedCountyParcelFacts("some-other-build").size).toBe(0);
  });

  it("skips a ZIP whose checksum fails while still loading every other ZIP", () => {
    writeSidecar({ zip: "60619", breakChecksum: true, factsByPin: { "25023160330000": facts() } });
    writeSidecar({
      zip: "60623",
      appendToManifest: true,
      factsByPin: { "16264270400000": facts({ countyClass: "211" }) },
    });

    const byPin = loadPrecomputedCountyParcelFacts(BUILD_ID);
    expect([...byPin.keys()]).toEqual(["16264270400000"]);
    // And the tampered ZIP's identities are refused too, while the good one loads.
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(0);
    expect(loadShortlistParcelIdentity("60623", BUILD_ID).size).toBe(1);
  });

  it("drops a facts key that is not a real 14-digit PIN", () => {
    writeSidecar({
      factsByPin: {
        "25023160330000": facts(),
        "123": facts({ countyClass: "999" }),
        "not-a-pin": facts({ countyClass: "888" }),
      },
    });
    const byPin = loadPrecomputedCountyParcelFacts(BUILD_ID);
    expect([...byPin.keys()]).toEqual(["25023160330000"]);
  });

  it("is empty, never throwing, when no ZIP publishes a facts block at all", () => {
    writeSidecar();
    expect(loadPrecomputedCountyParcelFacts(BUILD_ID).size).toBe(0);
    // Identities still load — facts are strictly additive.
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(1);
  });

  it("degrades a MALFORMED facts block to empty without taking the ZIP's identities down with it", () => {
    writeSidecar({ factsByPin: { "25023160330000": { countyClass: 517, checkedAt: "yesterday" } } });
    expect(loadPrecomputedCountyParcelFacts(BUILD_ID).size).toBe(0);
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(1);
  });

  it("caches per buildId — a second call does not re-read the files", () => {
    writeSidecar({ factsByPin: { "25023160330000": facts() } });
    const first = loadPrecomputedCountyParcelFacts(BUILD_ID);
    expect(first.size).toBe(1);
    rmSync(join(dir, "60619.json"));
    expect(loadPrecomputedCountyParcelFacts(BUILD_ID)).toBe(first);
  });

  it("never caches an unrecognized buildId — a caller cannot grow the map", () => {
    // This buildId arrives in a REQUEST body (/api/shortlist/enrich), so a
    // cache entry per arbitrary string would be an unbounded, caller-
    // controlled map. Only the manifest's own buildId is ever memoized.
    writeSidecar({ factsByPin: { "25023160330000": facts() } });
    expect(loadPrecomputedCountyParcelFacts(BUILD_ID).size).toBe(1);
    for (let index = 0; index < 50; index += 1) {
      expect(loadPrecomputedCountyParcelFacts(`attacker-build-${index}`).size).toBe(0);
    }
    // Proof those misses were never memoized: publishing a sidecar under one
    // of them now answers from disk instead of a cached empty map.
    writeSidecar({
      manifestBuildId: "attacker-build-7",
      fileBuildId: "attacker-build-7",
      factsByPin: { "25023160330000": facts() },
    });
    __resetShortlistParcelIdentityCacheForTests();
    expect(loadPrecomputedCountyParcelFacts("attacker-build-7").size).toBe(1);
  });

  it("does not memoize identity lookups for an unrecognized buildId either", () => {
    writeSidecar();
    expect(loadShortlistParcelIdentity("60619", "attacker-build").size).toBe(0);
    expect(loadShortlistParcelIdentityEntries("60619", "attacker-build").size).toBe(0);
    expect(loadShortlistParcelIdentity("60619", BUILD_ID).size).toBe(1);
  });
});

describe("the committed sidecars", () => {
  /**
   * A shape check against the REAL files, so a schema that only ever sees
   * hand-written fixtures cannot drift from what the precompute script
   * actually writes. Deliberately tolerant of an in-flight regeneration: a
   * ZIP whose file is mid-rewrite fails its checksum and loads as empty,
   * which is the correct behavior, not a test failure.
   */
  it("load with 14-digit PINs and full ISO check instants, or fail closed", () => {
    __setShortlistParcelIdentityDataDirForTests(null);
    __resetShortlistParcelIdentityCacheForTests();
    const manifestPath = join(process.cwd(), "data/exports/shortlist-universe/parcel-identity/manifest.json");
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      universeBuildId: string;
      files: Record<string, unknown>;
    };
    let loadedAny = false;
    for (const zip of Object.keys(manifest.files)) {
      const byKey = loadShortlistParcelIdentity(zip, manifest.universeBuildId);
      if (byKey.size > 0) loadedAny = true;
      for (const entry of byKey.values()) {
        expect(entry.pin).toMatch(/^\d{14}$/);
        expect(entry.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
      // The wrong universe never yields identities, committed data or not.
      expect(loadShortlistParcelIdentity(zip, "definitely-not-this-build").size).toBe(0);
    }
    // The committed sidecars must ACTUALLY load — a suite that only proved
    // "no exception" would stay green if the loader silently refused every
    // real file.
    expect(loadedAny).toBe(true);
  });
});

// ── The pure merge ──────────────────────────────────────────────────────────

function noOverlays(): CandidateOverlays {
  return {
    ssa: { present: false, name: null, unknown: false },
    ccsa: { present: false, name: null, unknown: false },
    tif: { present: false, name: null, unknown: false },
    nof: { present: false, name: null, unknown: false },
  };
}

function candidate(overrides: Partial<DecoratedShortlistCandidate> = {}): DecoratedShortlistCandidate {
  return {
    key: "site:aaa",
    address: "9324 S UNIVERSITY AVE",
    pin: null,
    lat: 41.72,
    lon: -87.59,
    propertyType: "vacant_land",
    screenedPropertyType: "vacant_land",
    buildingSqft: null,
    lotSqft: 3125,
    zoningDistrict: "RS-3",
    zoningStatus: "resolved",
    badge: "aligned",
    badgeNote: "note",
    ownerLabel: "Individual · in-state mailing address (unverified)",
    incentiveCount: null,
    saleYear: null,
    violation: false,
    conflictingPropertyTypes: false,
    overlays: noOverlays(),
    transitScore: null,
    score: 0,
    recordCompletenessScore: 3,
    nearestRailDisplay: null,
    expresswayDisplay: null,
    nearestSchool: null,
    nearestLibrary: null,
    ...overrides,
  };
}

function identity(entries: Record<string, ResolvedShortlistParcelIdentity>) {
  return new Map(Object.entries(entries));
}

describe("applyPrecomputedParcelIdentity", () => {
  const resolved: ResolvedShortlistParcelIdentity = {
    status: "resolved",
    pin: "25023160330000",
    countyAddress: "9324 S UNIVERSITY AVE, CHICAGO, IL 60619",
    checkedAt: CHECKED_AT,
  };

  it("fills in the PIN and exact-match provenance for a PIN-less row the sidecar resolved", () => {
    const [row] = applyPrecomputedParcelIdentity([candidate()], identity({ "site:aaa": resolved }));
    expect(row.pin).toBe("25023160330000");
    expect(row.pinProvenance).toEqual({
      source: "coordinate_exact_precomputed",
      checkedAt: CHECKED_AT,
      countyAddress: "9324 S UNIVERSITY AVE, CHICAGO, IL 60619",
    });
  });

  it("never overwrites a PIN the snapshot already published, and tags it saved_snapshot", () => {
    const [row] = applyPrecomputedParcelIdentity(
      [candidate({ pin: "16264270400000" })],
      identity({ "site:aaa": resolved }),
    );
    expect(row.pin).toBe("16264270400000");
    expect(row.pinProvenance).toEqual({ source: "saved_snapshot" });
  });

  it("leaves a PIN-less row with no sidecar entry exactly as it was", () => {
    const input = candidate();
    const [row] = applyPrecomputedParcelIdentity([input], identity({}));
    expect(row).toBe(input);
    expect(row.pin).toBeNull();
    expect(row.pinProvenance).toBeUndefined();
  });

  it("never substitutes an identity for a row whose own PIN is present but unusable", () => {
    const [row] = applyPrecomputedParcelIdentity(
      [candidate({ pin: "not-a-pin" })],
      identity({ "site:aaa": resolved }),
    );
    expect(row.pin).toBe("not-a-pin");
    expect(row.pinProvenance).toBeUndefined();
  });

  it("preserves length, order, and keys — it can never re-rank or drop a row", () => {
    const rows = [
      candidate({ key: "site:1", pin: null }),
      candidate({ key: "site:aaa" }),
      candidate({ key: "site:3", pin: "16264270400000" }),
    ];
    const merged = applyPrecomputedParcelIdentity(rows, identity({ "site:aaa": resolved }));
    expect(merged).toHaveLength(3);
    expect(merged.map((row) => row.key)).toEqual(["site:1", "site:aaa", "site:3"]);
    // The input array and its objects are untouched.
    expect(rows[1].pin).toBeNull();
    expect(rows[1].pinProvenance).toBeUndefined();
  });

  it("is a no-op on every row when the sidecar failed closed to an empty map", () => {
    const rows = [candidate(), candidate({ key: "site:2" })];
    const merged = applyPrecomputedParcelIdentity(rows, new Map());
    expect(merged.every((row) => row.pin === null && row.pinProvenance === undefined)).toBe(true);
  });
});
