import { describe, expect, it, vi } from "vitest";
import {
  buildZoningLegislationArtifact,
  buildZoningMapSnapshot,
  classifyZoningLegislation,
  classifyZoningLifecycle,
  diffZoningMapSnapshots,
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
  it("detects attribute and geometry changes separately using GLOBALID", () => {
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
    });
    expect(delta.changes.map((row) => row.change)).toEqual([
      "attributes_changed",
      "geometry_changed",
    ]);
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
