import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminOwnershipPanel } from "@/components/report/AdminOwnershipPanel";
import { fetchAdminOwnershipContext } from "@/lib/owner-file-report-context";
import type { OwnerClusterGeoFeatureCollection } from "@/lib/owner-cluster-geo";

/**
 * End-to-end gate logic for the report's admin-only ownership panel:
 * fetchAdminOwnershipContext (the probe-then-fetch orchestration extracted
 * from app/report/page.tsx's ReportDisplay effect) drives the panel's
 * status prop — a 204 probe with matching geo data must produce a rendered
 * panel, a 401 probe must resolve idle (which the panel renders as nothing)
 * WITHOUT ever requesting the geo data.
 */

const geoFixture: OwnerClusterGeoFeatureCollection = {
  type: "FeatureCollection",
  generatedAt: "2026-01-01T00:00:00.000Z",
  meta: { skippedNullLatLng: 0, zips: ["60617"] },
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-87.5605, 41.7137] },
      properties: {
        pin: "FAKE-60617-001",
        address: "9101 S Commercial Ave",
        vacant: true,
        zip: "60617",
        clusterKey: "mail:fakeowneronellc",
        ownerName: "FAKE OWNER ONE LLC",
        ownerType: "corporate_llc",
        clusterParcelCount: 6,
        clusterVacantCount: 4,
        confidence: "High",
      },
    },
  ],
};

function fetchStub(sessionStatus: number, geoBody?: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/owner-file/session")) {
      return { status: sessionStatus, ok: sessionStatus < 300 } as Response;
    }
    if (url.includes("/api/owner-file/geo")) {
      return { status: 200, ok: true, json: async () => geoBody } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("admin ownership panel gating", () => {
  it("probe 204 + matching geo data → ready result → panel renders with the match", async () => {
    const fetchImpl = fetchStub(204, geoFixture);
    const result = await fetchAdminOwnershipContext({
      zip: "60617",
      address: "9101 S Commercial Ave",
      fetchImpl,
    });

    expect(result.status).toBe("ready");
    expect(result.match?.pin).toBe("FAKE-60617-001");
    expect(result.topClusters).toHaveLength(1);

    const html = renderToStaticMarkup(
      <AdminOwnershipPanel
        status={result.status}
        zip="60617"
        match={result.match}
        topClusters={result.topClusters}
      />
    );
    expect(html).toContain("Admin Only");
    expect(html).toContain("FAKE OWNER ONE LLC");
    expect(html).toContain("4 of 6 parcels vacant");
  });

  it("probe 401 → idle result → panel renders nothing, and the geo endpoint is never requested", async () => {
    const fetchImpl = fetchStub(401);
    const result = await fetchAdminOwnershipContext({
      zip: "60617",
      address: "9101 S Commercial Ave",
      fetchImpl,
    });

    expect(result.status).toBe("idle");
    expect(result.match).toBeNull();
    expect(result.topClusters).toEqual([]);
    const requestedUrls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(requestedUrls.some((u) => u.includes("/api/owner-file/geo"))).toBe(false);

    const html = renderToStaticMarkup(
      <AdminOwnershipPanel
        status={result.status}
        zip="60617"
        match={result.match}
        topClusters={result.topClusters}
      />
    );
    expect(html).toBe("");
  });

  it("probe 204 but geo fetch fails → error result (admin sees the panel's error state, never a crash)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/owner-file/session")) {
        return { status: 204, ok: true } as Response;
      }
      return { status: 503, ok: false } as Response;
    }) as unknown as typeof fetch;

    const onAdminConfirmed = vi.fn();
    const result = await fetchAdminOwnershipContext({
      zip: "60617",
      address: "9101 S Commercial Ave",
      fetchImpl,
      onAdminConfirmed,
    });

    expect(onAdminConfirmed).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");

    const html = renderToStaticMarkup(
      <AdminOwnershipPanel status={result.status} zip="60617" match={null} topClusters={[]} />
    );
    expect(html).toContain("could not be loaded");
  });
});
