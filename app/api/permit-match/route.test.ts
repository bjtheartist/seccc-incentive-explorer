import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSQLMock, sqlMock } = vi.hoisted(() => ({
  getSQLMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: getSQLMock }));

import { GET } from "./route";

beforeEach(() => {
  getSQLMock.mockReset();
  sqlMock.mockReset();
  getSQLMock.mockReturnValue(sqlMock);
});

describe("GET /api/permit-match", () => {
  it("returns the stored match method and confidence", async () => {
    sqlMock.mockResolvedValue([
      {
        permit_id: "PERMIT-1",
        permit_type: "PERMIT - RENOVATION/ALTERATION",
        work_type: "INTERIOR ALTERATION",
        work_description: "Interior buildout",
        issue_date: "2026-08-20",
        reported_cost: 125000,
        permit_status: "ACTIVE",
        permit_milestone: "PERMIT ISSUED",
        permit_condition: null,
        match_method: "spatial_proximity",
        match_confidence: "low",
      },
    ]);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/permit-match?pin=21322110390000",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      matches: [
        {
          permitId: "PERMIT-1",
          matchMethod: "spatial_proximity",
          matchConfidence: "low",
        },
      ],
    });
  });

  it("serves proximity only as fallback and only on the closest parcel", async () => {
    sqlMock.mockResolvedValue([]);

    await GET(
      new NextRequest(
        "http://localhost/api/permit-match?pin=21322110390000",
      ),
    );

    const query = (sqlMock.mock.calls[0]?.[0] as TemplateStringsArray).join("?");
    expect(query).toContain("stronger.permit_id = m.permit_id");
    expect(query).toContain(
      "stronger.match_method IN ('pin_exact', 'address_normalized')",
    );
    expect(query).toContain("ST_DWithin(bp.geom, other_vp.geom");
    expect(query).toContain(
      "ST_Distance(bp.geom, other_vp.geom) < ST_Distance(bp.geom, vp.geom)",
    );
    expect(query).toContain("other_vp.id < vp.id");
  });

  it("distinguishes an unavailable database from an empty match result", async () => {
    getSQLMock.mockReturnValue(null);
    const response = await GET(
      new NextRequest(
        "http://localhost/api/permit-match?pin=21322110390000",
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "database not configured" });
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
