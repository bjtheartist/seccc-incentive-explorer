import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShortlistUniverseLoadResult } from "@/lib/shortlist-universe";
import type { ShortlistUniverseFile, ShortlistUniverseRow } from "@/lib/shortlist-universe-schema";

/**
 * FAIL-CLOSED coverage for app/vacancy/[zip]/shortlist/page.tsx (PR2 hard
 * cutover, revised after the adversarial-review fix round). Mirrors
 * app/vacancy/[zip]/__tests__/gating.test.tsx: the page is an async Server
 * Component called directly with its data loaders stubbed, so
 * renderToStaticMarkup can inspect the result without a running server.
 *
 * Every scenario here must render the SAME honest "Ranked shortlist
 * temporarily unavailable" state and link to the vacancy map — never a
 * false "zero sites match", and never a thrown error.
 */

const { loadShortlistUniverseMock, railStationsMock } = vi.hoisted(() => ({
  loadShortlistUniverseMock: vi.fn<(zip: string) => ShortlistUniverseLoadResult>(),
  railStationsMock: vi.fn<() => { name: string; system: string; lat: number; lon: number }[]>(() => []),
}));

vi.mock("@/lib/shortlist-universe", () => ({
  loadShortlistUniverse: loadShortlistUniverseMock,
}));

vi.mock("@/lib/vacancy-index", () => ({
  getVacancyIndexEdition: () => ({
    boundary: null,
    centroid: { lat: 41.75, lon: -87.6 },
  }),
  loadVacancyIndex: () => ({ generatedAt: "2026-08-01T00:00:00.000Z" }),
}));

vi.mock("@/lib/rail-stations", () => ({ railStations: railStationsMock }));

vi.mock("@/lib/shortlist-display-context", () => ({
  loadShortlistAmenityPoints: () => [],
  loadShortlistExpresswayContext: () => new Map(),
}));

vi.mock("@/components/vacancy/SiteShortlistResults", () => ({ default: () => null }));
vi.mock("@/components/vacancy/ShortlistFunnelEvent", () => ({ default: () => null }));

import ShortlistPage from "../page";

/** A minimal but schema-shaped row — never actually validated here since the
 *  loader itself is mocked, but kept realistic for readability. */
function fixtureRow(overrides: Partial<ShortlistUniverseRow> = {}): ShortlistUniverseRow {
  return {
    canonicalKey: "pin:20363230080000",
    pin: "20363230080000",
    address: "8000 S COTTAGE GROVE AVE",
    lat: 41.75,
    lon: -87.605,
    evidenceTypes: ["city_land"],
    hasVacantLandEvidence: false,
    hasVacantBuildingEvidence: true,
    conflictingPropertyTypes: false,
    propertyType: "vacant_building",
    buildingSqft: 4000,
    buildingSqftSource: "city_land",
    lotSqft: null,
    lotSqftSource: null,
    ownerStructure: "corporate_llc",
    ownerGeography: "out_of_state",
    ownerConfidence: "pin_matched",
    saleYear: null,
    violation: false,
    zoning: { status: "resolved", district: "B3-2", zoneType: 1, pdNum: null, pmdSubArea: null },
    overlays: {
      ssa: { present: false, name: null },
      ccsa: { present: false, name: null },
      tif: { present: false, name: null },
      nof: { present: false, name: null },
    },
    incentiveCount: 1,
    ...overrides,
  };
}

/** A fully schema-shaped universe file (current schema/ranking-inputs
 *  version), for building `ok: true` loader mocks with minimal per-test
 *  boilerplate. */
function fixtureUniverseFile(overrides: {
  rows?: ShortlistUniverseRow[];
  rankingInputsVersion?: 2;
  sourceRecordsByEvidenceType?: ShortlistUniverseFile["counts"]["sourceRecordsByEvidenceType"];
} = {}): ShortlistUniverseFile {
  const rows = overrides.rows ?? [];
  return {
    schemaVersion: 2,
    buildId: "build-1",
    generatedAt: "2026-08-01T00:00:00.000Z",
    zip: "60619",
    vacancySnapshotId: "snap-1",
    rankingInputsVersion: overrides.rankingInputsVersion ?? 2,
    sources: {
      vacancy: { vintage: "v", checksum: "c" },
      zoning: { vintage: "v", checksum: "c" },
      overlays: { vintage: "v", checksum: "c" },
    },
    counts: {
      sourceRecords: rows.length,
      sourceRecordsByEvidenceType: overrides.sourceRecordsByEvidenceType ?? {
        city_land: 0,
        "311_building": rows.filter((r) => r.hasVacantBuildingEvidence).length,
        "311_land": 0,
        assessor_vacant_land: 0,
      },
      canonicalSites: rows.length,
      buildings: rows.filter((r) => r.hasVacantBuildingEvidence).length,
      land: rows.filter((r) => r.hasVacantLandEvidence).length,
      withPin: rows.filter((r) => r.pin != null).length,
      withMeasuredArea: rows.filter((r) => r.lotSqft != null || r.buildingSqft != null).length,
      withZoning: rows.filter((r) => r.zoning.status === "resolved").length,
    },
    dedupe: { collapsedRecords: 0, conflictingPropertyTypes: 0, unresolvedConflicts: 0 },
    rows,
  };
}

const READY_SEARCH_PARAMS = {
  sm_use: "community-facility",
  sm_property: "existing-building",
};

async function render(searchParams: Record<string, string>) {
  return renderToStaticMarkup(
    await ShortlistPage({
      params: Promise.resolve({ zip: "60619" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  loadShortlistUniverseMock.mockReset();
  railStationsMock.mockReset();
  railStationsMock.mockReturnValue([]);
});

describe("Site Shortlist — fail-closed states", () => {
  it("renders the unavailable state when the manifest is missing", async () => {
    loadShortlistUniverseMock.mockReturnValue({ ok: false, reason: "manifest_missing" });
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).toContain("Ranked shortlist temporarily unavailable");
    expect(html).not.toMatch(/0 candidate records|no records match this brief/i);
    expect(html).toContain("Open the full vacancy map instead");
  });

  it("renders the unavailable state on a buildId mismatch between the file and the manifest", async () => {
    loadShortlistUniverseMock.mockReturnValue({
      ok: false,
      reason: "build_id_mismatch",
      detail: "file buildId x != manifest buildId y",
    });
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).toContain("Ranked shortlist temporarily unavailable");
  });

  it("renders the unavailable state when the universe file fails schema validation", async () => {
    loadShortlistUniverseMock.mockReturnValue({ ok: false, reason: "file_invalid_schema" });
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).toContain("Ranked shortlist temporarily unavailable");
  });

  it("renders the unavailable state for a checksum or row-count mismatch (Finding 7)", async () => {
    loadShortlistUniverseMock.mockReturnValue({ ok: false, reason: "file_checksum_mismatch" });
    expect(await render(READY_SEARCH_PARAMS)).toContain("Ranked shortlist temporarily unavailable");

    loadShortlistUniverseMock.mockReturnValue({ ok: false, reason: "file_row_count_mismatch" });
    expect(await render(READY_SEARCH_PARAMS)).toContain("Ranked shortlist temporarily unavailable");

    loadShortlistUniverseMock.mockReturnValue({ ok: false, reason: "file_counts_inconsistent" });
    expect(await render(READY_SEARCH_PARAMS)).toContain("Ranked shortlist temporarily unavailable");

    loadShortlistUniverseMock.mockReturnValue({ ok: false, reason: "manifest_vacancy_index_build_id_mismatch" });
    expect(await render(READY_SEARCH_PARAMS)).toContain("Ranked shortlist temporarily unavailable");
  });

  it("renders the unavailable state for an unknown criteriaVersion (sm_v) — and NEVER calls the universe loader for it", async () => {
    const html = await render({ ...READY_SEARCH_PARAMS, sm_v: "99" });
    expect(html).toContain("Ranked shortlist temporarily unavailable");
    // The version check must short-circuit BEFORE any data loading — an
    // unrecognized criteria shape must never be decoded and acted on.
    expect(loadShortlistUniverseMock).not.toHaveBeenCalled();
  });

  it("renders the unavailable state for an unknown ranking-model version (sm_rv) — Finding 5, and NEVER calls the universe loader for it", async () => {
    const html = await render({ ...READY_SEARCH_PARAMS, sm_rv: "99" });
    expect(html).toContain("Ranked shortlist temporarily unavailable");
    expect(loadShortlistUniverseMock).not.toHaveBeenCalled();
  });

  it("accepts a request with NO sm_v or sm_rv (pre-versioning back-compat) and proceeds past the version gate", async () => {
    loadShortlistUniverseMock.mockReturnValue({ ok: true, data: fixtureUniverseFile({ rows: [fixtureRow()] }) });
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).not.toContain("Ranked shortlist temporarily unavailable");
    expect(loadShortlistUniverseMock).toHaveBeenCalledWith("60619");
  });

  it("accepts the CURRENT sm_rv value explicitly", async () => {
    loadShortlistUniverseMock.mockReturnValue({ ok: true, data: fixtureUniverseFile({ rows: [fixtureRow()] }) });
    const html = await render({ ...READY_SEARCH_PARAMS, sm_rv: "2" });
    expect(html).not.toContain("Ranked shortlist temporarily unavailable");
  });

  it("renders the unavailable state when the loaded data's rankingInputsVersion does not match the engine's own version constant", async () => {
    // In production the zod schema literal would already reject a mismatched
    // rankingInputsVersion (ShortlistUniverseFileSchema pins it to exactly
    // RANKING_INPUTS_VERSION). This test exercises the page's explicit,
    // independent cross-check against RANKING_MODEL_VERSION — a second,
    // testable guard rather than relying solely on the schema.
    loadShortlistUniverseMock.mockReturnValue({
      ok: true,
      data: fixtureUniverseFile({ rankingInputsVersion: 1 as unknown as 2 }),
    });
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).toContain("Ranked shortlist temporarily unavailable");
  });

  it("does NOT fail closed for a genuinely empty (but valid) universe — that renders the honest funnel instead", async () => {
    loadShortlistUniverseMock.mockReturnValue({ ok: true, data: fixtureUniverseFile({ rows: [] }) });
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).not.toContain("Ranked shortlist temporarily unavailable");
    expect(html).toContain("No tracked evidence for this property type");
  });

  // ── Finding 8: selected-but-unavailable rail data ──────────────────────

  it("renders the unavailable state when a CTA/Metra criterion is selected but the rail-station source is empty (a load failure, not 'no stations nearby')", async () => {
    loadShortlistUniverseMock.mockReturnValue({ ok: true, data: fixtureUniverseFile({ rows: [fixtureRow()] }) });
    railStationsMock.mockReturnValue([]); // simulates lib/rail-stations.ts's load-failure degrade
    const html = await render({
      ...READY_SEARCH_PARAMS,
      sm_transport: "cta-rail",
      sm_transport_distance: "half-mile",
    });
    expect(html).toContain("Ranked shortlist temporarily unavailable");
  });

  it("does NOT fail closed when CTA/Metra is selected and the rail-station source IS available", async () => {
    loadShortlistUniverseMock.mockReturnValue({ ok: true, data: fixtureUniverseFile({ rows: [fixtureRow()] }) });
    railStationsMock.mockReturnValue([{ name: "79th", system: "CTA", lat: 41.751, lon: -87.605 }]);
    const html = await render({
      ...READY_SEARCH_PARAMS,
      sm_transport: "cta-rail",
      sm_transport_distance: "half-mile",
    });
    expect(html).not.toContain("Ranked shortlist temporarily unavailable");
  });

  it("does NOT fail closed when the rail source is empty but NO transit criterion was selected", async () => {
    loadShortlistUniverseMock.mockReturnValue({ ok: true, data: fixtureUniverseFile({ rows: [fixtureRow()] }) });
    railStationsMock.mockReturnValue([]);
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).not.toContain("Ranked shortlist temporarily unavailable");
  });
});
