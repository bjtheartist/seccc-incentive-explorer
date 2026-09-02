import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { STALE_PARCEL_FACTS_NOTE, type AreaStats } from "../map-helpers";
import { StaleFactsNote } from "../StaleFactsNote";
import { cachedFetchWithMeta, invalidateClientCache } from "@/lib/fetch-cache";

vi.mock("@/components/workspace/WatchAreaButton", () => ({
  WatchAreaButton: () => <button type="button">Watch this area</button>,
}));

const MapSnapshotPanel = (await import("../MapSnapshotPanel")).default;

/**
 * R2 finding 6 follow-up — a stale fallback has to be DISCLOSED.
 *
 * lib/fetch-cache.ts serves a previously-cached body when a live fetch fails,
 * which is the right call ("a stale zoning payload beats an empty panel"), and
 * `cachedFetchWithMeta` was added so a caller could tell the difference. It
 * shipped with zero production callers: every call site still used
 * `cachedFetch`, which throws the flag away, so a days-old assessor record
 * reached the map panels through the exact same path as a live 200 and no
 * reader could tell.
 *
 * The parcel read in MapView's loadCensusForPoint is now migrated, and these
 * are the two halves of that: the cache really does report the staleness, and
 * the panel really does render it.
 */

const BASE_STATS: AreaStats = {
  medianHomePrice: "$142,000",
  medianIncome: "$38,500",
  walkScore: 11,
  parcelPin: "20363230080000",
  parcelAddress: "8525 S EUCLID AVE, CHICAGO, IL 60617",
  assessedTotal: 41_250,
};

function renderPanel(stats: AreaStats): string {
  return renderToStaticMarkup(
    <MapSnapshotPanel
      areaStats={stats}
      snapshotLabel="Chicago (default)"
      snapshotLat={41.73}
      snapshotLon={-87.63}
      snapshotPrograms={[]}
      snapshotTifFinance={null}
      tifFinanceLoading={false}
      zoningInfo={null}
      isGeneratingSnapshot={false}
      onClose={() => {}}
      onDrawArea={() => {}}
      onGenerateSnapshot={() => {}}
    />,
  );
}

describe("cachedFetchWithMeta reports a stale fallback", () => {
  it("flags a body served from cache after the live fetch failed", async () => {
    invalidateClientCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const url = "https://example.test/api/parcel?lat=41.73&lon=-87.63";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pin: "20363230080000" }) })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" });
    vi.stubGlobal("fetch", fetchMock);

    const fresh = await cachedFetchWithMeta<{ pin: string }>(url);
    expect(fresh.stale).toBe(false);

    // Past the TTL (5 minutes for /api/parcel), with the live source now
    // failing: the cache still answers, and says the answer is old.
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    const stale = await cachedFetchWithMeta<{ pin: string }>(url);
    expect(stale.data.pin).toBe("20363230080000");
    expect(stale.stale).toBe(true);

    vi.useRealTimers();
    vi.unstubAllGlobals();
    invalidateClientCache();
  });
});

describe("the map snapshot panel discloses stale parcel facts", () => {
  it("renders the note when the parcel facts are a stale fallback", () => {
    const html = renderPanel({ ...BASE_STATS, parcelStale: true });
    expect(html).toContain("stale-parcel-facts-note");
    expect(html).toContain("Data may be stale");
    // The disclosure has to reach the reader before the dollar figures do.
    expect(html.indexOf("stale-parcel-facts-note")).toBeLessThan(html.indexOf("41,250"));
  });

  it("says nothing when the facts came from a live read", () => {
    const html = renderPanel({ ...BASE_STATS, parcelStale: false });
    expect(html).not.toContain("stale-parcel-facts-note");
    expect(html).toContain("41,250");
  });

  it("says nothing when the flag was never set at all", () => {
    expect(renderPanel(BASE_STATS)).not.toContain("stale-parcel-facts-note");
  });
});

describe("StaleFactsNote", () => {
  it("carries the one shared sentence, so the two surfaces cannot drift", () => {
    const html = renderToStaticMarkup(<StaleFactsNote stale />);
    expect(html).toContain(STALE_PARCEL_FACTS_NOTE.slice(0, 40));
    expect(renderToStaticMarkup(<StaleFactsNote stale={undefined} />)).toBe("");
  });
});
