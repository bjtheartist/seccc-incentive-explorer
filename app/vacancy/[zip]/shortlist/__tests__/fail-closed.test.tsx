import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShortlistUniverseLoadResult } from "@/lib/shortlist-universe";
import type { ShortlistUniverseRow } from "@/lib/shortlist-universe-schema";

/**
 * FAIL-CLOSED coverage for app/vacancy/[zip]/shortlist/page.tsx (PR2 hard
 * cutover). Mirrors app/vacancy/[zip]/__tests__/gating.test.tsx: the page is
 * an async Server Component called directly with its data loaders stubbed,
 * so renderToStaticMarkup can inspect the result without a running server.
 *
 * Every scenario here must render the SAME honest "Ranked shortlist
 * temporarily unavailable" state and link to the vacancy map — never a
 * false "zero sites match", and never a thrown error. See the PR2 build
 * spec: "If manifest/universe file is missing, fail closed."
 */

const { loadShortlistUniverseMock } = vi.hoisted(() => ({
  loadShortlistUniverseMock: vi.fn<(zip: string) => ShortlistUniverseLoadResult>(),
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

vi.mock("@/lib/rail-stations", () => ({ railStations: () => [] }));

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
    overlays: { ssa: false, ccsa: false, tif: false, nof: false },
    incentiveCount: 1,
    ...overrides,
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

  it("renders the unavailable state for an unknown criteriaVersion — and NEVER calls the universe loader for it", async () => {
    const html = await render({ ...READY_SEARCH_PARAMS, sm_v: "99" });
    expect(html).toContain("Ranked shortlist temporarily unavailable");
    // The version check must short-circuit BEFORE any data loading — an
    // unrecognized criteria shape must never be decoded and acted on.
    expect(loadShortlistUniverseMock).not.toHaveBeenCalled();
  });

  it("accepts a request with NO sm_v (pre-versioning back-compat) and proceeds past the version gate", async () => {
    loadShortlistUniverseMock.mockReturnValue({
      ok: true,
      data: {
        schemaVersion: 1,
        buildId: "build-1",
        generatedAt: "2026-08-01T00:00:00.000Z",
        zip: "60619",
        vacancySnapshotId: "snap-1",
        rankingInputsVersion: 1,
        sources: {
          vacancy: { vintage: "v", checksum: "c" },
          zoning: { vintage: "v", checksum: "c" },
          overlays: { vintage: "v", checksum: "c" },
        },
        counts: {
          sourceRecords: 1,
          canonicalSites: 1,
          buildings: 1,
          land: 0,
          withPin: 1,
          withMeasuredArea: 1,
          withZoning: 1,
        },
        dedupe: { collapsedRecords: 0, conflictingPropertyTypes: 0, unresolvedConflicts: 0 },
        rows: [fixtureRow()],
      },
    });
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).not.toContain("Ranked shortlist temporarily unavailable");
    expect(loadShortlistUniverseMock).toHaveBeenCalledWith("60619");
  });

  it("renders the unavailable state when the loaded data's rankingInputsVersion does not match the engine's own version constant", async () => {
    // In production the zod schema literal would already reject a mismatched
    // rankingInputsVersion (ShortlistUniverseFileSchema pins it to exactly
    // RANKING_INPUTS_VERSION). This test exercises the page's explicit,
    // independent cross-check against RANKING_MODEL_VERSION — a second,
    // testable guard rather than relying solely on the schema.
    loadShortlistUniverseMock.mockReturnValue({
      ok: true,
      data: {
        schemaVersion: 1,
        buildId: "build-1",
        generatedAt: "2026-08-01T00:00:00.000Z",
        zip: "60619",
        vacancySnapshotId: "snap-1",
        rankingInputsVersion: 2 as unknown as 1,
        sources: {
          vacancy: { vintage: "v", checksum: "c" },
          zoning: { vintage: "v", checksum: "c" },
          overlays: { vintage: "v", checksum: "c" },
        },
        counts: {
          sourceRecords: 0,
          canonicalSites: 0,
          buildings: 0,
          land: 0,
          withPin: 0,
          withMeasuredArea: 0,
          withZoning: 0,
        },
        dedupe: { collapsedRecords: 0, conflictingPropertyTypes: 0, unresolvedConflicts: 0 },
        rows: [],
      },
    });
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).toContain("Ranked shortlist temporarily unavailable");
  });

  it("does NOT fail closed for a genuinely empty (but valid) universe — that renders the honest funnel instead", async () => {
    loadShortlistUniverseMock.mockReturnValue({
      ok: true,
      data: {
        schemaVersion: 1,
        buildId: "build-1",
        generatedAt: "2026-08-01T00:00:00.000Z",
        zip: "60619",
        vacancySnapshotId: "snap-1",
        rankingInputsVersion: 1,
        sources: {
          vacancy: { vintage: "v", checksum: "c" },
          zoning: { vintage: "v", checksum: "c" },
          overlays: { vintage: "v", checksum: "c" },
        },
        counts: {
          sourceRecords: 0,
          canonicalSites: 0,
          buildings: 0,
          land: 0,
          withPin: 0,
          withMeasuredArea: 0,
          withZoning: 0,
        },
        dedupe: { collapsedRecords: 0, conflictingPropertyTypes: 0, unresolvedConflicts: 0 },
        rows: [],
      },
    });
    const html = await render(READY_SEARCH_PARAMS);
    expect(html).not.toContain("Ranked shortlist temporarily unavailable");
    expect(html).toContain("No tracked evidence for this property type");
  });
});
