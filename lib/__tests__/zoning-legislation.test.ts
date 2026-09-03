import { describe, expect, it, vi } from "vitest";
import {
  assessZoningMapChurn,
  buildZoningLegislationArtifact,
  buildZoningMapSnapshot,
  classifyZoningLegislation,
  classifyZoningLifecycle,
  diffZoningMapSnapshots,
  MAX_ZONING_MAP_CHURN_RATIO,
  fetchAllElmsZoningMatters,
  fetchElmsMatter,
  matterIdFromClerkUrl,
  normalizeElmsZoningMatter,
  normalizeZoningMapFeature,
} from "@/lib/zoning-legislation";

const MATTER_ID = "14999C67-FD08-F111-8406-001DD80D78DD";

function rawMatter(overrides: Record<string, unknown> = {}) {
  return {
    matterId: MATTER_ID,
    recordNumber: "O2026-0023281",
    fileYear: 2026,
    status: "90-Final",
    subStatus: "Passed",
    title: "Zoning Reclassification Map No. 11-H at 4000 N Lincoln Ave - App No. 23008T1",
    introductionDate: "2026-02-18T16:00:00+00:00",
    finalActionDate: "2026-05-20T15:00:00+00:00",
    lastPublicationDate: "2026-07-15T15:21:51+00:00",
    controllingBody: "City Council",
    ...overrides,
  };
}

function mapFeature(
  globalId: string,
  zoneClass: string,
  geometry: Record<string, unknown> = { rings: [[[0, 0], [1, 0], [0, 0]]] },
) {
  return {
    attributes: {
      GLOBALID: globalId,
      ZONING_ID: 1,
      ZONE_CLASS: zoneClass,
      ZONE_TYPE: 2,
      PD_NUM: null,
      PMD_SUB_AREA: null,
      ORDINANCE_NUM: "23008T1",
      ORDINANCE_DATE: Date.UTC(2026, 4, 20),
      CLERK_DOCNO: "O2026-0023281",
      CLERK_URL: `https://chicityclerkelms.chicago.gov/Matter/?matterId=${MATTER_ID}`,
      UPDATE_TIMESTAMP: Date.UTC(2026, 6, 15),
    },
    geometry,
  };
}

describe("zoning legislation normalization", () => {
  it("separates map amendments from ordinance text amendments", () => {
    expect(classifyZoningLegislation("Zoning Reclassification Map No. 11-H at 4000 N Lincoln Ave"))
      .toBe("map_amendment");
    expect(
      classifyZoningLegislation(
        "Amendment of ordinance (SO2022-1111) regarding Zoning Reclassification Map No. 16-D",
      ),
    ).toBe("map_amendment");
    expect(
      classifyZoningLegislation(
        "Zoning  Reclassification Map No. 13-I at 5145 N California Ave",
      ),
    ).toBe("map_amendment");
    expect(
      classifyZoningLegislation(
        "Amendment of Municipal Code Title 17 by modifying Section 17-3-0207",
      ),
    ).toBe("zoning_code_amendment");
    expect(classifyZoningLegislation("Special use application at 4000 N Lincoln Ave")).toBeNull();
    expect(
      classifyZoningLegislation(
        "Expression of opposition to proposed zoning reclassification at 854 W Castlewood Terr",
      ),
    ).toBeNull();
  });

  it("does not treat closed matters as adopted", () => {
    expect(classifyZoningLifecycle("90-Final", "Passed as Substitute")).toBe("adopted");
    expect(classifyZoningLifecycle("90-Final", "Withdrawn")).toBe("withdrawn");
    expect(classifyZoningLifecycle("90-Final", "Failed to Pass")).toBe("failed");
    expect(classifyZoningLifecycle("90-Final", "Placed on File")).toBe(
      "closed_without_adoption",
    );
    expect(classifyZoningLifecycle("4-In Committee", "Referred")).toBe("pending");
    // Filed with the Clerk and accepted onto a future Council agenda. This
    // fell through to "unknown" — a bucket that was empty until the City
    // started publishing it, so four live matters landed in a state the admin
    // ledger has no story for. It is the earliest PENDING state.
    expect(classifyZoningLifecycle("2-Submitted to Clerk", "Accepted")).toBe("pending");
  });

  it("preserves official actions and attachments without inferring parcel geometry", () => {
    const matter = normalizeElmsZoningMatter(
      rawMatter({
        actions: [
          {
            actionDate: "2026-05-20T05:00:00+00:00",
            actionByName: "City Council",
            actionName: "Passed",
            actionText: "The matter was Passed.",
            meetingId: "meeting-1",
          },
        ],
        attachments: [
          {
            fileName: "Final Ordinance.pdf",
            path: "https://example.test/final.pdf",
            attachmentType: "Legislation",
          },
        ],
      }),
      ["Zoning Reclassification"],
    );
    expect(matter).toMatchObject({
      matterId: MATTER_ID,
      lifecycle: "adopted",
      kind: "map_amendment",
      actions: [{ actionName: "Passed" }],
      attachments: [{ fileName: "Final Ordinance.pdf" }],
    });
    expect(matter).not.toHaveProperty("geometry");
  });

  it("requires the source publication timestamp and exact identifiers", () => {
    expect(normalizeElmsZoningMatter(rawMatter({ lastPublicationDate: null }))).toBeNull();
    expect(normalizeElmsZoningMatter(rawMatter({ matterId: null }))).toBeNull();
  });

  it("only accepts City Clerk matter URLs", () => {
    expect(
      matterIdFromClerkUrl(
        `https://chicityclerkelms.chicago.gov/Matter/?matterId=${MATTER_ID}`,
      ),
    ).toBe(MATTER_ID);
    expect(
      matterIdFromClerkUrl(`https://example.test/Matter/?matterId=${MATTER_ID}`),
    ).toBeNull();
  });
});

describe("official eLMS search paging", () => {
  it("normalizes the Clerk detail endpoint's observed double-encoded JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(JSON.stringify(rawMatter())), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchElmsMatter(
        { matterId: MATTER_ID },
        { fetchImpl: fetchImpl as typeof fetch },
      ),
    ).resolves.toMatchObject({
      matterId: MATTER_ID,
      recordNumber: "O2026-0023281",
      lifecycle: "adopted",
      kind: "map_amendment",
    });
  });

  it("fails closed when a double-encoded detail payload is malformed", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify("not-json"), { status: 200 }),
    );

    await expect(
      fetchElmsMatter(
        { matterId: MATTER_ID },
        { fetchImpl: fetchImpl as typeof fetch },
      ),
    ).rejects.toThrow("invalid zoning matter");
  });

  it("pages to the published count and deduplicates overlapping searches", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const search = url.searchParams.get("search");
      const skip = Number(url.searchParams.get("skip"));
      const second = rawMatter({
        matterId: "43D2458E-FC08-F111-8406-001DD80D78DD",
        recordNumber: "O2026-0023280",
        title: "Zoning Reclassification Map No. 11-H at 3900 N Lincoln Ave",
      });
      const data =
        search === '"Zoning Reclassification"'
          ? skip === 0
            ? [rawMatter()]
            : [second]
          : [rawMatter()];
      return new Response(
        JSON.stringify({
          data,
          meta: {
            skip,
            top: 500,
            count: search === '"Zoning Reclassification"' ? 2 : 1,
            pages: search === '"Zoning Reclassification"' ? 2 : 1,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const matters = await fetchAllElmsZoningMatters({
      fetchImpl: fetchImpl as typeof fetch,
      searches: ["Zoning Reclassification", "Title 17"],
    });
    expect(matters).toHaveLength(2);
    expect(matters.find((row) => row.matterId === MATTER_ID)?.searchTerms).toEqual([
      "Title 17",
      "Zoning Reclassification",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails closed when eLMS publishes malformed paging metadata", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [], meta: { count: "not-a-number" } }), {
        status: 200,
      }),
    );
    await expect(
      fetchAllElmsZoningMatters({
        fetchImpl: fetchImpl as typeof fetch,
        searches: ["Zoning Reclassification"],
      }),
    ).rejects.toThrow("invalid search page");
  });
});

describe("versioned zoning map snapshot", () => {
  /** A distinct polygon per index, so geometry can act as identity. */
  const polygonAt = (n: number) => ({
    rings: [[[n, 0], [n + 1, 0], [n, 1], [n, 0]]],
  });

  it("detects attribute and geometry changes separately when the id is stable", () => {
    // Geometry moved AND attributes moved, under an unchanged GLOBALID. The
    // geometry-keyed pass cannot pair these (the boundary is the key and it
    // changed), so the secondary GLOBALID pass has to catch it — otherwise a
    // genuine redraw would be buried as added+removed.
    const beforeRecord = normalizeZoningMapFeature(mapFeature("g-1", "B1-2"))!;
    const afterRecord = normalizeZoningMapFeature(
      mapFeature("g-1", "B1-3", { rings: [[[0, 0], [2, 0], [0, 0]]] }),
    )!;
    const delta = diffZoningMapSnapshots(
      buildZoningMapSnapshot([beforeRecord]),
      buildZoningMapSnapshot([afterRecord]),
    );
    expect(delta.counts).toEqual({
      added: 0,
      removed: 0,
      attributesChanged: 1,
      geometryChanged: 1,
      rekeyed: 0,
    });
    expect(delta.changes.map((row) => row.change)).toEqual([
      "attributes_changed",
      "geometry_changed",
    ]);
    expect(delta.changes.every((row) => row.previousGlobalId === null)).toBe(true);
  });

  it("fingerprints published attributes WITHOUT the GLOBALID", () => {
    // The false negative at the heart of PR #254: the same parcel, published
    // under two different ids, is attribute-identical and must fingerprint
    // identically. When `globalId` was inside the hash, every record in the
    // layer looked attribute-changed and none of them were reported as such.
    const asPublished = normalizeZoningMapFeature(mapFeature("old-id", "RS-3"))!;
    const afterRotation = normalizeZoningMapFeature(mapFeature("new-id", "RS-3"))!;
    expect(afterRotation.globalId).not.toBe(asPublished.globalId);
    expect(afterRotation.attributeFingerprint).toBe(asPublished.attributeFingerprint);
    expect(afterRotation.geometryFingerprint).toBe(asPublished.geometryFingerprint);

    // ...and a real attribute change must still move the fingerprint.
    const reclassified = normalizeZoningMapFeature(mapFeature("new-id", "B3-2"))!;
    expect(reclassified.attributeFingerprint).not.toBe(asPublished.attributeFingerprint);
  });

  it("never joins on zoningId, which is a zone-class code and not an identity", () => {
    // ZONING_ID is identical across these two distinct parcels (69 distinct
    // values across ~15,000 records citywide). Keying on it would collapse
    // them into one record; the review's "zoningId was 100% stable" is true
    // only because it does not address anything.
    const before = [
      normalizeZoningMapFeature({ ...mapFeature("a", "RS-3"), geometry: polygonAt(1) })!,
      normalizeZoningMapFeature({ ...mapFeature("b", "RS-3"), geometry: polygonAt(2) })!,
    ];
    expect(before[0].zoningId).toBe(before[1].zoningId);
    const delta = diffZoningMapSnapshots(
      buildZoningMapSnapshot(before),
      buildZoningMapSnapshot(before),
    );
    expect(delta.counts.added + delta.counts.removed).toBe(0);
    expect(delta.changes).toEqual([]);
  });

  it("pairs records that share a geometry fingerprint one-for-one", () => {
    // ~3 records per snapshot share a boundary hash, so the geometry key is
    // a bucket, not a unique index. Equal-size buckets must fully pair.
    const dup = (id: string) =>
      normalizeZoningMapFeature({ ...mapFeature(id, "RS-3"), geometry: polygonAt(7) })!;
    const delta = diffZoningMapSnapshots(
      buildZoningMapSnapshot([dup("a1"), dup("a2")]),
      buildZoningMapSnapshot([dup("z1"), dup("z2")]),
    );
    expect(delta.counts.added).toBe(0);
    expect(delta.counts.removed).toBe(0);
    expect(delta.counts.rekeyed).toBe(2);
  });

  // ── The 2026-09-02 event, in miniature ────────────────────────────────────
  it("reports a full GLOBALID rotation as re-keying, not as a replaced map", () => {
    const STABLE = 40;
    const before = [
      // The stable body of the map, published under its old ids.
      ...Array.from({ length: STABLE }, (_, i) =>
        normalizeZoningMapFeature({
          ...mapFeature(`old-${String(i).padStart(3, "0")}`, "RS-3"),
          geometry: polygonAt(i),
        })!,
      ),
      // One parcel the City genuinely dropped.
      normalizeZoningMapFeature({
        ...mapFeature("old-gone", "RS-3"),
        geometry: polygonAt(900),
      })!,
    ];
    const after = [
      ...Array.from({ length: STABLE }, (_, i) =>
        normalizeZoningMapFeature({
          // EVERY id rotated; geometry byte-identical; one parcel (index 0)
          // genuinely reclassified underneath the new id.
          ...mapFeature(`new-${String(i).padStart(3, "0")}`, i === 0 ? "B3-2" : "RS-3"),
          geometry: polygonAt(i),
        })!,
      ),
      // One parcel the City genuinely added.
      normalizeZoningMapFeature({
        ...mapFeature("new-fresh", "RS-3"),
        geometry: polygonAt(901),
      })!,
    ];

    const delta = diffZoningMapSnapshots(
      buildZoningMapSnapshot(before),
      buildZoningMapSnapshot(after),
    );

    // The whole point: 1 / 1 / 1, not 41 added and 41 removed.
    expect(delta.counts).toEqual({
      added: 1,
      removed: 1,
      attributesChanged: 1,
      geometryChanged: 0,
      rekeyed: STABLE,
    });

    const added = delta.changes.filter((row) => row.change === "added");
    const removed = delta.changes.filter((row) => row.change === "removed");
    expect(added.map((row) => row.globalId)).toEqual(["new-fresh"]);
    expect(removed.map((row) => row.globalId)).toEqual(["old-gone"]);

    // The reclassification survives the rotation instead of vanishing into
    // "attributesChanged: 0" — and carries the id it used to be published under.
    const attributeChange = delta.changes.find(
      (row) => row.change === "attributes_changed",
    )!;
    expect(attributeChange.globalId).toBe("new-000");
    expect(attributeChange.previousGlobalId).toBe("old-000");
    expect(attributeChange.before?.zoneClass).toBe("RS-3");
    expect(attributeChange.after?.zoneClass).toBe("B3-2");

    // Every re-keyed record is countable, and a genuine add/remove is not one.
    expect(delta.changes.filter((row) => row.previousGlobalId != null)).toHaveLength(
      STABLE,
    );
    expect(added[0].previousGlobalId).toBeNull();
    expect(removed[0].previousGlobalId).toBeNull();
  });

  // ── Churn bound ───────────────────────────────────────────────────────────
  // No test in this repo bounded snapshot churn, so the 2026-09-02 refresh —
  // which claimed 100% of Chicago's zoning map had been replaced — passed all
  // 31 gating tests and the full 5,950-test suite. That is the coverage gap.
  describe("churn bound", () => {
    const layer = (prefix: string, size: number, offset = 0) =>
      buildZoningMapSnapshot(
        Array.from({ length: size }, (_, i) =>
          normalizeZoningMapFeature({
            ...mapFeature(`${prefix}-${i}`, "RS-3"),
            geometry: polygonAt(i + offset),
          })!,
        ),
      );

    it("passes a normal day, and the real 2026-09-02 movement", () => {
      // 4.0% — 330 added + 264 removed against 14,986 features, the largest
      // genuine daily movement on record. The bound must not cry wolf on it.
      const delta = {
        counts: { added: 330, removed: 264, attributesChanged: 0, geometryChanged: 0, rekeyed: 14656 },
      } as ReturnType<typeof diffZoningMapSnapshots>;
      const churn = assessZoningMapChurn(
        delta,
        { featureCount: 14920 } as never,
        { featureCount: 14986 } as never,
      );
      expect(churn.ratio).toBeLessThan(MAX_ZONING_MAP_CHURN_RATIO);
      expect(churn.withinBounds).toBe(true);
    });

    it("TRIPS on the delta a GLOBALID-keyed comparator would have published", () => {
      // Disjoint geometry as well as disjoint ids: nothing pairs, so this is
      // a genuine wholesale replacement — exactly the shape the old
      // comparator invented, and the shape a human must see before it ships.
      const before = layer("old", 60, 0);
      const after = layer("new", 60, 1000);
      const delta = diffZoningMapSnapshots(before, after);
      expect(delta.counts.added).toBe(60);
      expect(delta.counts.removed).toBe(60);
      const churn = assessZoningMapChurn(delta, before, after);
      expect(churn.ratio).toBeGreaterThan(MAX_ZONING_MAP_CHURN_RATIO);
      expect(churn.withinBounds).toBe(false);
    });

    it("does NOT trip when the same churn is really an id rotation", () => {
      // The regression guard for the fix itself. Same geometry, every id
      // rotated: added+removed is 0, so the bound never fires and the refresh
      // publishes an honest `rekeyed` count instead of dying or lying.
      const before = layer("old", 60, 0);
      const after = layer("new", 60, 0);
      const delta = diffZoningMapSnapshots(before, after);
      expect(delta.counts.rekeyed).toBe(60);
      expect(assessZoningMapChurn(delta, before, after).withinBounds).toBe(true);
    });

    it("never trips on a first-run baseline, which has nothing to compare against", () => {
      const current = layer("new", 60, 0);
      const delta = diffZoningMapSnapshots(null, current);
      expect(assessZoningMapChurn(delta, null, current).withinBounds).toBe(true);
    });
  });

  it("is deterministic: the same pair of snapshots diffs identically", () => {
    const build = (prefix: string) =>
      buildZoningMapSnapshot(
        Array.from({ length: 12 }, (_, i) =>
          normalizeZoningMapFeature({
            ...mapFeature(`${prefix}-${i}`, "RS-3"),
            geometry: polygonAt(i),
          })!,
        ),
      );
    const before = build("old");
    const after = build("new");
    expect(JSON.stringify(diffZoningMapSnapshots(before, after))).toBe(
      JSON.stringify(diffZoningMapSnapshots(before, after)),
    );
  });

  it("builds deterministic coverage counts and source freshness", () => {
    const artifact = buildZoningLegislationArtifact([
      normalizeElmsZoningMatter(rawMatter())!,
      normalizeElmsZoningMatter(
        rawMatter({
          matterId: "6EE8302F-A8AA-F011-BBD2-001DD80B7FF7",
          recordNumber: "SO2025-0020513",
          fileYear: 2025,
          status: "4-In Committee",
          subStatus: "Referred",
          title: "Amendment of Municipal Code Title 17 by modifying Section 17-7-0574",
          lastPublicationDate: "2025-12-18T20:20:07+00:00",
        }),
      )!,
    ]);
    expect(artifact.coverage.total).toBe(2);
    expect(artifact.coverage.byKind).toEqual({
      map_amendment: 1,
      zoning_code_amendment: 1,
    });
    expect(artifact.coverage.byLifecycle.pending).toBe(1);
    expect(artifact.source.sourceUpdatedThrough).toBe("2026-07-15T15:21:51.000Z");
  });
});
