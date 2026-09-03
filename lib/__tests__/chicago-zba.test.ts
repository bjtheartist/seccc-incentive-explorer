import { describe, expect, it, vi } from "vitest";
import {
  buildChicagoZbaSnapshot,
  classifyChicagoZbaCaseType,
  diffChicagoZbaSnapshots,
  lookupChicagoZba,
  normalizeChicagoZbaFeature,
  normalizeChicagoZbaSnapshotFeature,
  parseChicagoZbaCaseReference,
} from "../chicago-zba";

function feature(
  overrides: Record<string, unknown> = {},
  geometry: Record<string, unknown> = { rings: [[[0, 0], [1, 0], [0, 0]]] },
) {
  return {
    attributes: {
      OBJECTID: 1,
      ORDINANCE: "71-25-Z",
      ORD_YEAR: "71",
      ORD_CASE: "2025",
      ORD_TYPE: "Z",
      ADDRESS: "118 S CLINTON ST",
      JUDGMENT: "Granted with Conditions",
      DESC_: "Variation request as published by the City.",
      PIN10: "1716101001",
      ID: "71-25-Z",
      GLOBALID: "g-1",
      PIN_ACCURACY: "MATCHED",
      ...overrides,
    },
    geometry,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Chicago ZBA source normalization", () => {
  it("parses year and sequence from the case reference instead of swapped source columns", () => {
    expect(parseChicagoZbaCaseReference("71-25-Z")).toEqual({
      caseReference: "71-25-Z",
      caseYear: 2025,
      caseSequence: 71,
      caseTypeRaw: "Z",
      caseType: "variation",
    });
    expect(parseChicagoZbaCaseReference("051-87-S")).toMatchObject({
      caseYear: 1987,
      caseSequence: 51,
      caseType: "special_use",
    });

    const normalized = normalizeChicagoZbaFeature(feature());
    expect(normalized).toMatchObject({
      caseYear: 2025,
      caseSequence: 71,
      publishedYearField: "71",
      publishedCaseField: "2025",
    });
  });

  it("preserves raw judgments and leaves unknown case types unknown", () => {
    const normalized = normalizeChicagoZbaFeature(
      feature({ ORDINANCE: "12-24-Q", ORD_TYPE: "Q", JUDGMENT: "Aproved/Cont." }),
    );
    expect(normalized).toMatchObject({
      caseType: "unknown",
      caseTypeRaw: "Q",
      judgment: "Aproved/Cont.",
    });
    expect(classifyChicagoZbaCaseType("not-published")).toBe("unknown");
  });

  it("returns source-honest not_found and unavailable states", async () => {
    const emptyFetch = vi.fn(async () => jsonResponse({ features: [] }));
    const empty = await lookupChicagoZba(41.88, -87.64, {
      fetchImpl: emptyFetch as typeof fetch,
      retries: 0,
    });
    expect(empty).toMatchObject({
      status: "not_found",
      returnedCount: 0,
      coverage: "complete",
    });
    expect(empty.message).toContain("does not establish");

    const failedFetch = vi.fn(async () => jsonResponse({ error: { code: 500 } }, 500));
    const failed = await lookupChicagoZba(41.88, -87.64, {
      fetchImpl: failedFetch as typeof fetch,
      retries: 0,
    });
    expect(failed).toMatchObject({ status: "unavailable", cases: [] });
    expect(failed).not.toHaveProperty("returnedCount");
  });

  it("marks a partly malformed or truncated feature response partial", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request) =>
      jsonResponse({
        features: [feature(), { attributes: { ORDINANCE: "2-24-S" } }],
        exceededTransferLimit: true,
      }),
    );
    const result = await lookupChicagoZba(41.88, -87.64, {
      fetchImpl: fetchImpl as typeof fetch,
      retries: 0,
    });
    expect(result).toMatchObject({
      status: "available",
      returnedCount: 1,
      coverage: "partial",
    });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toContain("/MapServer/16/query");
    expect(url.searchParams.get("inSR")).toBe("4326");
    expect(url.searchParams.get("returnGeometry")).toBe("false");
  });
});

describe("Chicago ZBA source snapshot", () => {
  it("tracks attributes and geometry separately without republishing geometry", () => {
    const beforeRecord = normalizeChicagoZbaSnapshotFeature(feature())!;
    const afterRecord = normalizeChicagoZbaSnapshotFeature(
      feature(
        { JUDGMENT: "DENIED" },
        { rings: [[[0, 0], [2, 0], [0, 0]]] },
      ),
    )!;
    expect(beforeRecord).not.toHaveProperty("geometry");
    const delta = diffChicagoZbaSnapshots(
      buildChicagoZbaSnapshot([beforeRecord]),
      buildChicagoZbaSnapshot([afterRecord]),
    );
    expect(delta.counts).toEqual({
      added: 0,
      removed: 0,
      attributesChanged: 1,
      geometryChanged: 1,
    });
  });

  it("ignores the stored attributeFingerprint and recomputes both sides", () => {
    // Same exposure the zoning map layer was bitten by: `previous` is loaded
    // from disk and its stored fingerprint is whatever formula was in force
    // when it was written. Nothing on either side of this comparison changed,
    // so a stored value that disagrees must not manufacture a change.
    const record = normalizeChicagoZbaSnapshotFeature(feature())!;
    const stale = { ...record, attributeFingerprint: "0".repeat(64) };
    const unchanged = { added: 0, removed: 0, attributesChanged: 0, geometryChanged: 0 };

    expect(
      diffChicagoZbaSnapshots(
        buildChicagoZbaSnapshot([stale]),
        buildChicagoZbaSnapshot([record]),
      ).counts,
    ).toEqual(unchanged);
    expect(
      diffChicagoZbaSnapshots(
        buildChicagoZbaSnapshot([record]),
        buildChicagoZbaSnapshot([stale]),
      ).counts,
    ).toEqual(unchanged);

    // ...and a real judgment change is still reported through stale storage.
    const decided = normalizeChicagoZbaSnapshotFeature(feature({ JUDGMENT: "DENIED" }))!;
    expect(
      diffChicagoZbaSnapshots(
        buildChicagoZbaSnapshot([stale]),
        buildChicagoZbaSnapshot([decided]),
      ).counts.attributesChanged,
    ).toBe(1);
  });

  it("does not invent a source refresh timestamp", () => {
    const snapshot = buildChicagoZbaSnapshot([
      normalizeChicagoZbaSnapshotFeature(feature())!,
    ]);
    expect(snapshot.source.sourceUpdatedThrough).toBeNull();
    expect(snapshot.source.freshnessNote).toContain("does not publish");
    expect(snapshot.coverage).toEqual({
      byCaseType: {
        special_use: 0,
        variation: 1,
        administrative_appeal: 0,
        unknown: 0,
      },
      withoutPublishedJudgment: 0,
      withoutParsedCaseReference: 0,
    });
  });
});
