import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { OwnerCluster } from "@/lib/corridor-owners";

/**
 * Regression coverage for the corridor owners 500 (2026-07-10): the deployed
 * database's parcels table predates the migrate-parcels.ts zip backfill, so
 * `WHERE zip = ...` threw NeonDbError `column "zip" does not exist` (42703)
 * and every Corridor Intelligence report shipped without its Owner &
 * Operator Map. The route must serve the committed static export (or an
 * empty list) on schema drift — never a 500 — and, per the corridor-metrics
 * doctrine, must fall back to the static export when the live database has
 * no parcel data (prod, by design).
 */

const { getSQLMock, fetchOwnerClustersMock, loadStaticOwnerClustersMock } = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
  fetchOwnerClustersMock: vi.fn(),
  loadStaticOwnerClustersMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getSQL: getSQLMock,
}));

vi.mock("@/lib/corridor-owners", () => ({
  fetchOwnerClusters: fetchOwnerClustersMock,
  loadStaticOwnerClusters: loadStaticOwnerClustersMock,
}));

import { GET } from "./route";

function ownersRequest(query: string) {
  return new NextRequest(`http://localhost/api/corridor/owners${query}`);
}

function schemaError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

const liveCluster: OwnerCluster = {
  clusterKey: "mail:pobox123chicagoil",
  ownerName: "SOUTHWORKS LLC",
  ownerMailingAddress: "PO BOX 123 CHICAGO IL",
  ownerType: "LLC",
  parcelCount: 2,
  vacantParcelCount: 1,
  businessCount: 1,
  businessNames: ["Southworks Hardware"],
  sampleAddresses: ["8900 S COMMERCIAL AVE"],
  latestTransferDate: "2025-11-02",
  latestBuyerName: "SOUTHWORKS LLC",
  latestSellerName: "OLD OWNER TRUST",
  confidence: "High",
  evidence: "grouped by recorded owner mailing address",
};

const staticCluster: OwnerCluster = {
  ...liveCluster,
  clusterKey: "static:cluster",
  ownerName: "STATIC EXPORT OWNER",
};

beforeEach(() => {
  getSQLMock.mockReset();
  fetchOwnerClustersMock.mockReset();
  loadStaticOwnerClustersMock.mockReset();
  getSQLMock.mockReturnValue({});
  loadStaticOwnerClustersMock.mockReturnValue(null);
});

describe("GET /api/corridor/owners", () => {
  it("rejects a non-5-digit zip with 400", async () => {
    const res = await GET(ownersRequest("?zip=abc"));
    expect(res.status).toBe(400);
  });

  it("serves live clusters when the database query returns rows", async () => {
    fetchOwnerClustersMock.mockResolvedValue([liveCluster]);
    const res = await GET(ownersRequest("?zip=60619&limit=50"));
    expect(res.status).toBe(200);
    expect((await res.json()).clusters).toEqual([liveCluster]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("serves the static export when parcels.zip is missing (42703 regression, was a 500)", async () => {
    fetchOwnerClustersMock.mockRejectedValue(schemaError("42703", 'column "zip" does not exist'));
    loadStaticOwnerClustersMock.mockReturnValue([staticCluster]);
    const res = await GET(ownersRequest("?zip=60619&limit=50"));
    expect(res.status).toBe(200);
    expect((await res.json()).clusters).toEqual([staticCluster]);
    expect(loadStaticOwnerClustersMock).toHaveBeenCalledWith("60619", 50);
  });

  it("returns empty clusters on schema drift when no static export exists", async () => {
    fetchOwnerClustersMock.mockRejectedValue(schemaError("42703", 'column "zip" does not exist'));
    const res = await GET(ownersRequest("?zip=60619&limit=50"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clusters: [] });
  });

  it("serves the static export when the parcels table is missing (42P01)", async () => {
    fetchOwnerClustersMock.mockRejectedValue(schemaError("42P01", 'relation "parcels" does not exist'));
    loadStaticOwnerClustersMock.mockReturnValue([staticCluster]);
    const res = await GET(ownersRequest("?zip=60619&limit=50"));
    expect(res.status).toBe(200);
    expect((await res.json()).clusters).toEqual([staticCluster]);
  });

  it("falls back to the static export when the live database has no parcel data (prod)", async () => {
    fetchOwnerClustersMock.mockResolvedValue([]);
    loadStaticOwnerClustersMock.mockReturnValue([staticCluster]);
    const res = await GET(ownersRequest("?zip=60619&limit=50"));
    expect(res.status).toBe(200);
    expect((await res.json()).clusters).toEqual([staticCluster]);
  });

  it("serves the static export when DATABASE_URL is not configured", async () => {
    getSQLMock.mockReturnValue(null);
    loadStaticOwnerClustersMock.mockReturnValue([staticCluster]);
    const res = await GET(ownersRequest("?zip=60619&limit=50"));
    expect(res.status).toBe(200);
    expect((await res.json()).clusters).toEqual([staticCluster]);
    expect(fetchOwnerClustersMock).not.toHaveBeenCalled();
  });

  it("still surfaces unrelated database failures as 500", async () => {
    fetchOwnerClustersMock.mockRejectedValue(schemaError("57014", "query canceled"));
    const res = await GET(ownersRequest("?zip=60619&limit=50"));
    expect(res.status).toBe(500);
  });
});
