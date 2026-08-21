import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShortlistUniverseLoadResult } from "@/lib/shortlist-universe";
import type { ShortlistUniverseFile } from "@/lib/shortlist-universe-schema";

/**
 * build-spec.md PR-A item 3/4/6 (F4 copy honesty, F8 display honesty).
 * Mirrors fail-closed.test.tsx's mocking pattern (same page, same loaders).
 *
 * F4: "Canonical sites (deduped)" and "complete canonical vacant-property
 * universe" implied more certainty than the pipeline actually has before a
 * County parcel resolves the record — the binding replacement copy is exact.
 *
 * F8: the shortlist footer must disclose, in the SAME exact words, that
 * display-only expressway context is coverage-dependent and a missing match
 * never removes or re-ranks a candidate (the per-card version of this is
 * covered in SiteShortlistResults.test.tsx).
 */

const { loadShortlistUniverseMock } = vi.hoisted(() => ({
  loadShortlistUniverseMock: vi.fn<(zip: string) => ShortlistUniverseLoadResult>(),
}));

vi.mock("@/lib/shortlist-universe", () => ({ loadShortlistUniverse: loadShortlistUniverseMock }));
vi.mock("@/lib/vacancy-index", () => ({
  getVacancyIndexEdition: () => ({ boundary: null, centroid: { lat: 41.75, lon: -87.6 } }),
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

/** trackedEvidence is driven by `counts.sourceRecordsByEvidenceType`
 *  independent of `rows` (see lib/shortlist-engine.ts's trackedEvidenceCount)
 *  — an empty `rows` array with a non-zero building count is the simplest
 *  fixture that reaches the "nothing cleared the screens" funnel list (the
 *  ONLY branch that renders the FUNNEL_STAGES labels), without needing a
 *  realistic screening scenario. */
function fixtureUniverseFile(): ShortlistUniverseFile {
  return {
    schemaVersion: 2,
    buildId: "build-1",
    generatedAt: "2026-08-01T00:00:00.000Z",
    zip: "60619",
    vacancySnapshotId: "snap-1",
    rankingInputsVersion: 2,
    sources: {
      vacancy: { vintage: "v", checksum: "c" },
      zoning: { vintage: "v", checksum: "c" },
      overlays: { vintage: "v", checksum: "c" },
    },
    counts: {
      sourceRecords: 5,
      sourceRecordsByEvidenceType: {
        city_land: 0,
        "311_building": 5,
        "311_land": 0,
        assessor_vacant_land: 0,
      },
      canonicalSites: 0,
      buildings: 0,
      land: 0,
      withPin: 0,
      withMeasuredArea: 0,
      withZoning: 0,
    },
    dedupe: { collapsedRecords: 0, conflictingPropertyTypes: 0, unresolvedConflicts: 0 },
    rows: [],
  };
}

const READY_SEARCH_PARAMS = {
  sm_use: "community-facility",
  sm_property: "existing-building",
};

async function render(searchParams: Record<string, string> = READY_SEARCH_PARAMS) {
  return renderToStaticMarkup(
    await ShortlistPage({
      params: Promise.resolve({ zip: "60619" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  loadShortlistUniverseMock.mockReset();
  loadShortlistUniverseMock.mockReturnValue({ ok: true, data: fixtureUniverseFile() });
});

describe("Site Shortlist page — F4 exact replacement copy", () => {
  it("renders the exact funnel-stage label 'Source-aggregated records (before County parcel resolution)' — never 'Canonical sites (deduped)'", async () => {
    const html = await render();
    expect(html).toContain("Source-aggregated records (before County parcel resolution)");
    expect(html).not.toContain("Canonical sites (deduped)");
  });

  it("renders the smoothed footer replacement 'source-aggregated vacant-property snapshot published for this area' — never 'complete canonical vacant-property universe'", async () => {
    const html = await render();
    expect(html).toContain("source-aggregated vacant-property snapshot published for this area");
    expect(html).not.toContain("complete canonical vacant-property universe");
  });
});

describe("Site Shortlist page — F8 display-honesty footer disclosure", () => {
  it("discloses that display-only expressway context is coverage-dependent and never removes or re-ranks a candidate", async () => {
    const html = await render();
    expect(html).toContain(
      "Display-only expressway context is available only where the separate context snapshot has a matching key; a missing match does not remove or re-rank a candidate.",
    );
  });
});

// ── The old strings must appear NOWHERE in app/ or components/ ────────────
// Grep-level coverage lives in its own file so it scans the whole tree once,
// independent of any single page's render path — see
// app/vacancy/__tests__/pin-copy-grep.test.ts.
