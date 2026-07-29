import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { isConfiguredMock, hasSessionMock, loadMock, filterMock } = vi.hoisted(() => ({
  isConfiguredMock: vi.fn(),
  hasSessionMock: vi.fn(),
  loadMock: vi.fn(),
  filterMock: vi.fn(),
}));

vi.mock("@/lib/owner-files-admin-auth", () => ({
  OWNER_FILES_ADMIN_COOKIE: "cie_owner_files_admin",
  isOwnerFilesAdminConfigured: isConfiguredMock,
  hasValidOwnerFilesAdminSession: hasSessionMock,
}));

vi.mock("@/lib/community-investment", () => ({
  INVESTMENT_SOURCES: ["cdg", "cook-source-2023", "dceo-capital"],
  loadCommunityInvestment: loadMock,
  filterInvestmentBySources: filterMock,
}));

vi.mock("@/lib/investment-deck-modes", () => ({
  parseFunderHqCsv: vi.fn(() => []),
}));

import { GET } from "./route";

const sourceLink = "https://example.com/official-source";
const fakeData = {
  generatedAt: "2026-07-28T00:00:00.000Z",
  meta: { totalRecords: 5 },
  records: [
    {
      id: "cdg-point",
      source: "cdg",
      recipient: "Ordinary grant recipient",
      geometry: { kind: "point", lat: 41.75, lng: -87.58 },
      amountAwarded: 50_000,
      links: [sourceLink],
    },
    {
      id: "cook-a",
      source: "cook-source-2023",
      recipient: "Cook recipient A",
      geometry: { kind: "zip_area", zip: "60617" },
      amountAwarded: 10_000,
      links: [sourceLink],
    },
    {
      id: "cook-b",
      source: "cook-source-2023",
      recipient: "Cook recipient B",
      geometry: { kind: "zip_area", zip: "60617" },
      amountAwarded: 20_000,
      links: [sourceLink],
    },
    {
      id: "dceo-point",
      source: "dceo-capital",
      recipient: "Address-sited state project",
      geometry: { kind: "point", lat: 41.76, lng: -87.59 },
      amountAwarded: null,
      publishedBalance: 750_000,
      links: [sourceLink],
    },
    {
      id: "dceo-citywide",
      source: "dceo-capital",
      recipient: "Unplotted state project",
      geometry: { kind: "citywide" },
      amountAwarded: null,
      publishedBalance: 1_250_000,
      links: [sourceLink],
    },
  ],
};

function req(url: string) {
  return new NextRequest(url);
}

beforeEach(() => {
  isConfiguredMock.mockReset().mockReturnValue(true);
  hasSessionMock.mockReset().mockReturnValue(true);
  loadMock.mockReset().mockReturnValue(fakeData);
  filterMock.mockReset().mockImplementation((data, sources: string[] | null) => ({
    ...data,
    records: sources
      ? data.records.filter((record: { source: string }) => sources.includes(record.source))
      : data.records,
  }));
});

describe("GET /api/owner-file/investment", () => {
  it("keeps the private dataset behind the configured admin session", async () => {
    hasSessionMock.mockReturnValue(false);
    const res = await GET(req("http://localhost/api/owner-file/investment?view=map"));
    expect(res.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("projects recipient-level county rows and unplotted state rows out of the map response", async () => {
    const res = await GET(req("http://localhost/api/owner-file/investment?view=map"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.records.map((record: { id: string }) => record.id)).toEqual([
      "cdg-point",
      "dceo-point",
    ]);
    expect(body.countyReliefByZip).toEqual([
      {
        zipCode: "60617",
        awardCount: 2,
        totalDisbursed: 30_000,
        year: 2023,
        sourceLink,
      },
    ]);
    expect(body.stateCapitalCitywideCount).toBe(1);
    expect(JSON.stringify(body)).not.toContain("Cook recipient");
    expect(JSON.stringify(body)).not.toContain("Unplotted state project");
    expect(body.countyReliefByZip[0]).not.toHaveProperty("recipient");
  });

  it("retains authorized source-level rows outside the projected map view", async () => {
    const res = await GET(
      req("http://localhost/api/owner-file/investment?source=cook-source-2023"),
    );
    const body = await res.json();

    expect(body.records.map((record: { id: string }) => record.id)).toEqual([
      "cook-a",
      "cook-b",
    ]);
    expect(body).not.toHaveProperty("countyReliefByZip");
  });
});
