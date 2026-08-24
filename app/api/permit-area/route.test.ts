import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSQLMock, sqlMock } = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

import { GET, POST } from "./route";

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

const MULTI_POLYGON: GeoJSON.MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    POLYGON.coordinates,
    [
      [
        [-87.8, 41.95],
        [-87.78, 41.95],
        [-87.78, 41.97],
        [-87.8, 41.97],
        [-87.8, 41.95],
      ],
    ],
  ],
};

const MONTHLY_BREAKDOWN = Array.from({ length: 36 }, (_, index) => {
  const month = new Date(Date.UTC(2023, 8 + index, 1)).toISOString().slice(0, 7);
  const filingCount = month === "2025-08" ? 1 : month === "2026-08" ? 2 : 0;
  return { month, filing_count: filingCount };
});

function requestFor(polygon: unknown = POLYGON) {
  const params = new URLSearchParams({ polygon: JSON.stringify(polygon) });
  return new NextRequest(`http://localhost/api/permit-area?${params.toString()}`);
}

function postRequestFor(polygon: unknown = POLYGON) {
  return new NextRequest("http://localhost/api/permit-area", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ polygon }),
  });
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

  it("accepts an official-style MultiPolygon without dropping detached pieces", async () => {
    sqlMock.mockResolvedValue([
      {
        total_filings: 0,
        distinct_addresses: 0,
        first_issue_date: null,
        latest_issue_date: null,
        source_as_of: null,
        type_breakdown: [],
        year_breakdown: [],
        status_breakdown: [],
        recent_filings: [],
      },
    ]);

    const response = await GET(requestFor(MULTI_POLYGON));
    expect(response.status).toBe(200);
    expect(sqlMock).toHaveBeenCalledOnce();
    expect(sqlMock.mock.calls[0]).toContain(JSON.stringify(MULTI_POLYGON));
  });

  it("aggregates the complete polygon set and returns bounded recent records", async () => {
    sqlMock.mockResolvedValue([
      {
        total_filings: "3",
        distinct_addresses: "2",
        first_issue_date: "2025-08-04",
        latest_issue_date: "2026-08-04",
        source_as_of: "2026-08-04 18:22:00+00",
        current_start: "2025-08-05",
        current_end: "2026-08-04",
        current_filings: 2,
        current_distinct_addresses: 1,
        current_addressed_filings: 2,
        previous_start: "2024-08-05",
        previous_end: "2025-08-04",
        previous_filings: 1,
        previous_distinct_addresses: 1,
        previous_addressed_filings: 1,
        monthly_breakdown: MONTHLY_BREAKDOWN,
        top_addresses: [{ address: "123 S STATE ST", filing_count: 2 }],
        type_breakdown: [
          { permit_type: "PERMIT - NEW CONSTRUCTION", filing_count: 2 },
          { permit_type: "SOURCE-SPECIFIC TYPE", filing_count: 1 },
        ],
        year_breakdown: [
          { year: 2026, filing_count: 2 },
          { year: 2025, filing_count: 1 },
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
    expect(body.issueDateSpan).toEqual({ first: "2025-08-04", latest: "2026-08-04" });
    expect(body.dataWindow).toBe("Since 2015");
    expect(body.sourceRefresh).toEqual({
      asOf: "2026-08-04T18:22:00.000Z",
      asOfBasis: "latest_queried_row_fetched_at",
    });
    expect(body.rollingPulse).toEqual({
      asOf: "2026-08-04",
      current: {
        start: "2025-08-05",
        end: "2026-08-04",
        filings: 2,
        distinctAddresses: 1,
        addressedFilings: 2,
      },
      previous: {
        start: "2024-08-05",
        end: "2025-08-04",
        filings: 1,
        distinctAddresses: 1,
        addressedFilings: 1,
      },
      changeCount: 1,
      changePercent: 100,
    });
    expect(body.monthlyBreakdown).toHaveLength(36);
    expect(body.monthlyBreakdown[0]).toEqual({ month: "2023-09", count: 0 });
    expect(body.monthlyBreakdown.at(-1)).toEqual({ month: "2026-08", count: 2 });
    expect(body.topAddresses).toEqual([{ address: "123 S STATE ST", count: 2 }]);
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
    expect(query).toContain("MAX(fetched_at)::text");
    expect(query).toContain(
      "regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g')",
    );
    expect(query).toContain("INTERVAL '1 year'");
    expect(query).toContain("INTERVAL '2 years'");
    expect(query).toContain("INTERVAL '35 months'");
    expect(query).toContain("generate_series");
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
        source_as_of: null,
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
    expect(body.sourceRefresh).toEqual({ asOf: null, asOfBasis: null });
    expect(body.recordsTruncated).toBe(false);
    expect(body.rollingPulse).toEqual({
      asOf: null,
      current: {
        start: null,
        end: null,
        filings: 0,
        distinctAddresses: 0,
        addressedFilings: 0,
      },
      previous: {
        start: null,
        end: null,
        filings: 0,
        distinctAddresses: 0,
        addressedFilings: 0,
      },
      changeCount: 0,
      changePercent: null,
    });
    expect(body.monthlyBreakdown).toEqual([]);
    expect(body.topAddresses).toEqual([]);
  });

  it("returns 503 instead of converting query failure into zero activity", async () => {
    sqlMock.mockRejectedValue(new Error("connection failed"));
    const response = await GET(requestFor());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "permit area analysis unavailable" });
  });
});

describe("POST /api/permit-area", () => {
  it("accepts a body-carried official MultiPolygon without URL-size limits", async () => {
    sqlMock.mockResolvedValue([
      {
        total_filings: 0,
        distinct_addresses: 0,
        first_issue_date: null,
        latest_issue_date: null,
        source_as_of: null,
        type_breakdown: [],
        year_breakdown: [],
        status_breakdown: [],
        recent_filings: [],
      },
    ]);

    const response = await POST(postRequestFor(MULTI_POLYGON));
    expect(response.status).toBe(200);
    expect(sqlMock).toHaveBeenCalledOnce();
    expect(sqlMock.mock.calls[0]).toContain(JSON.stringify(MULTI_POLYGON));
  });

  it("rejects malformed JSON and missing geometry", async () => {
    const malformed = new NextRequest("http://localhost/api/permit-area", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const missing = new NextRequest("http://localhost/api/permit-area", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(missing)).status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
