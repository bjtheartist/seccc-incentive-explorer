import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSQLMock, sqlMock } = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

import { GET } from "./route";

const POLYGON: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-87.65, 41.87],
      [-87.6, 41.87],
      [-87.6, 41.9],
      [-87.65, 41.9],
      [-87.65, 41.87],
    ],
  ],
};

function requestFor(polygon: unknown = POLYGON) {
  const params = new URLSearchParams({ polygon: JSON.stringify(polygon) });
  return new NextRequest(`http://localhost/api/permit-area?${params.toString()}`);
}

beforeEach(() => {
  getSQLMock.mockReset();
  sqlMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
});

describe("GET /api/permit-area", () => {
  it("rejects missing, malformed, open, and invalid-coordinate polygons", async () => {
    const requests = [
      new NextRequest("http://localhost/api/permit-area"),
      new NextRequest("http://localhost/api/permit-area?polygon=not-json"),
      requestFor({ type: "Point", coordinates: [-87.6, 41.8] }),
      requestFor({
        type: "Polygon",
        coordinates: [[[-87.6, 41.8], [-87.5, 41.8], [-87.5, 41.9], [-87.6, 41.9]]],
      }),
      requestFor({
        type: "Polygon",
        coordinates: [[[181, 41.8], [181, 41.9], [180, 41.9], [181, 41.8]]],
      }),
    ];

    for (const request of requests) {
      const response = await GET(request);
      expect(response.status).toBe(400);
    }
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the permit database is unavailable", async () => {
    getSQLMock.mockReturnValue(null);
    const response = await GET(requestFor());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "database not configured" });
  });

  it("aggregates the complete polygon set and returns bounded recent records", async () => {
    sqlMock.mockResolvedValue([
      {
        total_filings: "3",
        distinct_addresses: "2",
        first_issue_date: "2024-01-10",
        latest_issue_date: "2026-08-04",
        type_breakdown: [
          { permit_type: "PERMIT - NEW CONSTRUCTION", filing_count: 2 },
          { permit_type: "SOURCE-SPECIFIC TYPE", filing_count: 1 },
        ],
        year_breakdown: [
          { year: 2026, filing_count: 2 },
          { year: 2024, filing_count: 1 },
        ],
        status_breakdown: [
          { permit_status: "ACTIVE", filing_count: 2 },
          { permit_status: "COMPLETE", filing_count: 1 },
        ],
        recent_filings: [
          {
            permit_id: "100012345",
            permit_type: "PERMIT - NEW CONSTRUCTION",
            address: "123 S STATE ST",
            issue_date: "2026-08-04",
            permit_status: "ACTIVE",
            permit_milestone: "PERMIT ISSUED",
            work_type: "NEW CONSTRUCTION",
            work_description: "Construct a two-story commercial building",
            reported_cost: "999999999",
          },
        ],
      },
    ]);

    const response = await GET(requestFor());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect(body.totalFilings).toBe(3);
    expect(body.distinctAddresses).toBe(2);
    expect(body.issueDateSpan).toEqual({ first: "2024-01-10", latest: "2026-08-04" });
    expect(body.typeBreakdown).toEqual([
      {
        key: "new_construction",
        label: "New Construction",
        sourceValue: "PERMIT - NEW CONSTRUCTION",
        color: "#059669",
        count: 2,
      },
      {
        key: null,
        label: "SOURCE-SPECIFIC TYPE",
        sourceValue: "SOURCE-SPECIFIC TYPE",
        color: "#64748B",
        count: 1,
      },
    ]);
    expect(body.records).toHaveLength(1);
    expect(body.recordsTruncated).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/reported.?cost|999999999/i);

    const query = String(sqlMock.mock.calls[0][0]);
    const values = sqlMock.mock.calls[0].slice(1);
    expect(query).toContain("ST_Intersects");
    expect(query).toContain("geom IS NOT NULL");
    expect(query).toContain("COUNT(*)::int");
    expect(query).not.toContain("reported_cost");
    expect(query.toLowerCase()).not.toContain("sum(");
    expect(values).toContain("2015-01-01");
    expect(values).toContain(250);
  });

  it("returns an honest ready empty result", async () => {
    sqlMock.mockResolvedValue([
      {
        total_filings: 0,
        distinct_addresses: 0,
        first_issue_date: null,
        latest_issue_date: null,
        type_breakdown: [],
        year_breakdown: [],
        status_breakdown: [],
        recent_filings: [],
      },
    ]);

    const response = await GET(requestFor());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.totalFilings).toBe(0);
    expect(body.issueDateSpan).toBeNull();
    expect(body.recordsTruncated).toBe(false);
  });

  it("returns 503 instead of converting query failure into zero activity", async () => {
    sqlMock.mockRejectedValue(new Error("connection failed"));
    const response = await GET(requestFor());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "permit area analysis unavailable" });
  });
});

