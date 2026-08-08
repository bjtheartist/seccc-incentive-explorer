import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMIT_MAP_TYPES } from "@/lib/permit-map";

const { getSQLMock, sqlMock } = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getSQL: getSQLMock,
}));

import { GET } from "./route";

const BOUNDS = "-87.75,41.75,-87.55,41.95";

beforeEach(() => {
  getSQLMock.mockReset();
  sqlMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
});

describe("GET /api/permits", () => {
  it("requires a valid ordered viewport", async () => {
    const cases = [
      "",
      "-87.7,41.7,-87.5",
      "west,41.7,-87.5,41.9",
      "-87.5,41.7,-87.7,41.9",
      "-181,41.7,-87.5,41.9",
    ];

    for (const bounds of cases) {
      const suffix = bounds ? `?bounds=${encodeURIComponent(bounds)}` : "";
      const response = await GET(
        new NextRequest(`http://localhost/api/permits${suffix}`),
      );
      expect(response.status).toBe(400);
    }

    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("validates limit and selected permit type keys before querying", async () => {
    for (const limit of ["0", "3001", "1.5", "many"]) {
      const response = await GET(
        new NextRequest(
          `http://localhost/api/permits?bounds=${BOUNDS}&limit=${limit}`,
        ),
      );
      expect(response.status).toBe(400);
    }

    const emptyTypes = await GET(
      new NextRequest(`http://localhost/api/permits?bounds=${BOUNDS}&types=`),
    );
    expect(emptyTypes.status).toBe(400);

    const unknownType = await GET(
      new NextRequest(
        `http://localhost/api/permits?bounds=${BOUNDS}&types=new_construction,other`,
      ),
    );
    expect(unknownType.status).toBe(400);
    expect(await unknownType.json()).toEqual({
      error: "unknown permit type key: other",
    });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the permit database is unavailable", async () => {
    getSQLMock.mockReturnValue(null);

    const response = await GET(
      new NextRequest(`http://localhost/api/permits?bounds=${BOUNDS}`),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "database not configured" });
  });

  it("filters selected type keys in PostGIS and returns normalized GeoJSON", async () => {
    sqlMock.mockResolvedValue([
      {
        permit_id: "100012345",
        permit_type: "PERMIT - NEW CONSTRUCTION",
        address: "123 S STATE ST",
        issue_date: "2026-08-04",
        permit_status: "ACTIVE",
        permit_milestone: "PERMIT ISSUED",
        work_type: "NEW CONSTRUCTION",
        work_description: "Construct a two-story commercial building",
        lat: "41.8819",
        lon: "-87.6278",
        source_as_of: "2026-08-04T14:30:00.000Z",
        reported_cost: "999999999",
      },
    ]);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/permits?bounds=${BOUNDS}&types=new_construction,signs&limit=25`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect(body).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-87.6278, 41.8819] },
          properties: {
            permitId: "100012345",
            permitTypeKey: "new_construction",
            permitTypeLabel: "New Construction",
            rawPermitType: "PERMIT - NEW CONSTRUCTION",
            address: "123 S STATE ST",
            issueDate: "2026-08-04",
            permitStatus: "ACTIVE",
            permitMilestone: "PERMIT ISSUED",
            workType: "NEW CONSTRUCTION",
            workDescription: "Construct a two-story commercial building",
          },
        },
      ],
      meta: {
        sourceMode: "database",
        sourcePath: "database:building_permits",
        asOf: "2026-08-04T14:30:00.000Z",
        asOfBasis: "latest_queried_row_fetched_at",
        returnedCount: 1,
        configuredLimit: 25,
        queryLimit: 26,
        coverageStatus: "complete",
        potentiallyTruncated: false,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/reported.?cost|999999999/i);

    const query = String(sqlMock.mock.calls[0][0]);
    const values = sqlMock.mock.calls[0].slice(1);
    expect(query).toContain("ST_Intersects");
    expect(query).toContain("issue_date >=");
    expect(query).toContain("permit_type = ANY");
    expect(values).toContain("2015-01-01");
    expect(values).toContainEqual([
      "PERMIT - NEW CONSTRUCTION",
      "PERMIT - SIGNS",
    ]);
    expect(values).toContain(26);
  });

  it("discloses truncation when a sentinel row exceeds the configured limit", async () => {
    sqlMock.mockResolvedValue([
      {
        permit_id: "cap-1",
        permit_type: "PERMIT - SIGNS",
        address: "1 S STATE ST",
        issue_date: "2026-08-04",
        permit_status: "ACTIVE",
        permit_milestone: "PERMIT ISSUED",
        work_type: "SIGN",
        work_description: "Install sign",
        lat: "41.8819",
        lon: "-87.6278",
        source_as_of: "2026-08-05T00:00:00.000Z",
      },
      {
        permit_id: "cap-2",
        permit_type: "PERMIT - SIGNS",
        address: "2 S STATE ST",
        issue_date: "2026-08-03",
        permit_status: "ACTIVE",
        permit_milestone: "PERMIT ISSUED",
        work_type: "SIGN",
        work_description: "Install sign",
        lat: "41.8818",
        lon: "-87.6277",
        source_as_of: "2026-08-05T00:00:00.000Z",
      },
      {
        permit_id: "sentinel",
        permit_type: "PERMIT - SIGNS",
        address: "3 S STATE ST",
        issue_date: "2026-08-02",
        permit_status: "ACTIVE",
        permit_milestone: "PERMIT ISSUED",
        work_type: "SIGN",
        work_description: "Install sign",
        lat: "41.8817",
        lon: "-87.6276",
        source_as_of: "2026-08-05T00:00:00.000Z",
      },
    ]);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/permits?bounds=${BOUNDS}&types=signs&limit=2`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.features).toHaveLength(2);
    expect(body.features.map((feature: GeoJSON.Feature) => feature.properties?.permitId)).not.toContain(
      "sentinel",
    );
    expect(body.meta).toEqual({
      sourceMode: "database",
      sourcePath: "database:building_permits",
      asOf: "2026-08-05T00:00:00.000Z",
      asOfBasis: "latest_queried_row_fetched_at",
      returnedCount: 2,
      configuredLimit: 2,
      queryLimit: 3,
      coverageStatus: "truncated",
      potentiallyTruncated: true,
    });
  });

  it("accepts the map viewport cap", async () => {
    sqlMock.mockResolvedValue([]);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/permits?bounds=${BOUNDS}&types=signs&limit=3000`,
      ),
    );

    expect(response.status).toBe(200);
    expect(sqlMock.mock.calls[0].slice(1)).toContain(3001);
  });

  it("queries every map type by default and drops unusable rows", async () => {
    sqlMock.mockResolvedValue([
      {
        permit_id: "known",
        permit_type: "PERMIT - SIGNS",
        address: null,
        issue_date: null,
        permit_status: null,
        permit_milestone: null,
        work_type: null,
        work_description: null,
        lat: 41.88,
        lon: -87.63,
      },
      {
        permit_id: "retired",
        permit_type: "PERMIT - PORCH CONSTRUCTION",
        lat: 41.88,
        lon: -87.63,
      },
      {
        permit_id: "no-coordinate",
        permit_type: "PERMIT - SIGNS",
        lat: null,
        lon: null,
      },
    ]);

    const response = await GET(
      new NextRequest(`http://localhost/api/permits?bounds=${BOUNDS}`),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.features).toHaveLength(2);
    expect(sqlMock.mock.calls[0].slice(1)).toContainEqual(
      PERMIT_MAP_TYPES.map((type) => type.sourceValue),
    );
  });

  it("returns 503 instead of claiming an empty viewport after a query failure", async () => {
    sqlMock.mockRejectedValue(new Error("connection failed"));

    const response = await GET(
      new NextRequest(`http://localhost/api/permits?bounds=${BOUNDS}`),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "permit map unavailable" });
  });
});
