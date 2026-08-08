import { describe, expect, it, vi } from "vitest";
import {
  fetchPermitArea,
  formatPermitAreaDate,
  permitAreaRequestPath,
  type PermitAreaResult,
} from "@/lib/permit-area";

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

const RESULT: PermitAreaResult = {
  status: "ready",
  source: { label: "City permits", url: "https://example.com/data", portalUrl: "https://example.com/verify" },
  dataWindow: "2015-present",
  locatedRecordsOnly: true,
  totalFilings: 1,
  distinctAddresses: 1,
  issueDateSpan: { first: "2026-08-04", latest: "2026-08-04" },
  typeBreakdown: [],
  yearBreakdown: [],
  statusBreakdown: [],
  records: [],
  recordsReturned: 0,
  recordsTruncated: true,
};

describe("permit area client", () => {
  it("builds a reproducible polygon request", () => {
    const path = permitAreaRequestPath(POLYGON);
    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe("/api/permit-area");
    expect(JSON.parse(url.searchParams.get("polygon") ?? "")).toEqual(POLYGON);
  });

  it("returns a ready source-backed result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(RESULT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(fetchPermitArea(POLYGON, fetchImpl)).resolves.toEqual(RESULT);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("treats HTTP and malformed readiness responses as lookup failures", async () => {
    const unavailable = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    await expect(fetchPermitArea(POLYGON, unavailable)).rejects.toThrow("HTTP 503");

    const malformed = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "partial" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(fetchPermitArea(POLYGON, malformed)).rejects.toThrow("not ready");
  });

  it("formats source dates without changing unparseable values", () => {
    expect(formatPermitAreaDate("2026-08-04")).toBe("Aug 4, 2026");
    expect(formatPermitAreaDate("source value")).toBe("source value");
    expect(formatPermitAreaDate(null)).toBe("Not recorded");
  });
});

