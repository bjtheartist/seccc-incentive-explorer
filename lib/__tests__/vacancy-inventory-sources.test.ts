import { describe, expect, it, vi } from "vitest";
import {
  CCLBA_PUBLIC_API_URL,
  CCLBA_PUBLIC_DATASET_ID,
  CCLBA_PUBLIC_PORTAL_URL,
  CCLBA_STABLE_SORT,
  attachColsOwnership,
  buildCclbaPublicInventoryPageUrl,
  fetchCclbaPublicInventory,
  normalizeCclbaInventoryAsset,
  normalizeColsInventoryRecord,
  type CclbaSourceAsset,
} from "@/lib/vacancy-inventory-sources";

const RETRIEVED_AT = "2026-08-26T18:00:00.000Z";

describe("COLS provenance and Chi Block Builder context", () => {
  it("retains the official row id/application fields without making managing org the owner", () => {
    const normalized = normalizeColsInventoryRecord(
      {
        id: "63033",
        pin: "20-09-309-042-0000",
        address: "5244 S UNION AVE",
        latitude: "41.79844939944439",
        longitude: "-87.64318554669639",
        managing_organization: "CBB Round 1",
        property_status: "Sold",
        sales_status: "Application(s) Received",
        offer_round: "CBB-Nov-2023",
        application_use: "Side yard",
        application_opens: "2023-11-01T00:00:00.000",
        application_deadline: "2023-11-30T00:00:00.000",
        application_url: { url: "https://blockbuilder.example/apply" },
        last_update: "09/12/2025",
        square_footage_city_estimate: "3142.0",
      },
      RETRIEVED_AT,
    );
    expect(normalized).toMatchObject({
      id: "cols-20-09-309-042-0000",
      sourceRowId: "63033",
      pinDigits: "20093090420000",
      managingOrganization: "CBB Round 1",
      propertyStatus: "Sold",
      programName: "Chi Block Builder",
      programKey: "chi_block_builder",
      offerRound: "CBB-Nov-2023",
      applicationUrl: "https://blockbuilder.example/apply",
      sourceAsOf: "2025-09-12T00:00:00.000Z",
      sourceRetrievedAt: RETRIEVED_AT,
      squareFeet: 3142,
    });
    if (!normalized) throw new Error("Expected valid COLS fixture");
    expect(attachColsOwnership([normalized], new Map())[0]).toMatchObject({
      ownerName: "Unknown",
      ownerType: "unknown",
      ownerJurisdiction: null,
      managingOrganization: "CBB Round 1",
    });
  });

  it("synthesizes City ownership only for exact Owned by City status", () => {
    const base = {
      id: "34053",
      pin: "20-28-200-010-0000",
      address: "348 W 72ND ST",
      latitude: "41.7639",
      longitude: "-87.6342",
    };
    const held = normalizeColsInventoryRecord(
      {
        ...base,
        property_status: "Owned by City",
        application_url: "https://chi-block-builder.example/apply",
      },
      RETRIEVED_AT,
    );
    const unknown = normalizeColsInventoryRecord(base, RETRIEVED_AT);
    if (!held || !unknown) {
      throw new Error("Expected valid COLS fixtures");
    }
    expect(attachColsOwnership([held], new Map())[0]).toMatchObject({
      ownerName: "City of Chicago",
      ownerType: "city_public",
      ownerJurisdiction: "city_of_chicago",
      applicationUrl: "https://chi-block-builder.example/apply",
    });
    expect(attachColsOwnership([unknown], new Map())[0]).toMatchObject({
      ownerName: "Unknown",
      ownerType: "unknown",
      ownerJurisdiction: null,
    });
    for (const applicationUrl of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "/relative",
      "not a url",
    ]) {
      expect(
        normalizeColsInventoryRecord(
          { ...base, id: `unsafe-${applicationUrl}`, application_url: applicationUrl },
          RETRIEVED_AT,
        )?.applicationUrl,
      ).toBeNull();
    }
  });
});

describe("CCLBA public inventory", () => {
  const asset: CclbaSourceAsset = {
    id: 1_002_952,
    parcelNumber: "16-14-101-009-0000",
    propertyAddress1: "3856 W Monroe St",
    city: " CHICAGO ",
    state: "IL",
    postalCode: "60624",
    latitude: 41.88008,
    longitude: -87.72299,
    currentStatus: "Acquired",
    propertyClass: "Residential Land",
    inventoryType: "Vacant Land",
    parcelSquareFootage: 6_942,
    structureSquareFootage: null,
    structureType: "Land",
    occupied: "No",
    minimumBid: 7_500,
    neighborhood: "West Garfield Park",
    comments: "Published offer instructions",
  };

  it("preserves the published inventory context and asserts ownership only for Acquired", () => {
    expect(normalizeCclbaInventoryAsset(asset, RETRIEVED_AT)).toMatchObject({
      id: "cclba-1002952",
      sourceRowId: "1002952",
      pinDigits: "16141010090000",
      propertyType: "vacant_land",
      squareFeet: 6_942,
      status: "Acquired",
      inventoryType: "Vacant Land",
      propertyClass: "Residential Land",
      ownerName: "Cook County Land Bank Authority",
      ownerType: "city_public",
      ownerJurisdiction: "cook_county",
      programName: null,
      programKey: null,
      applicationOpens: null,
      applicationDeadline: null,
      applicationUrl: null,
      programContext: [{
        sourceRowId: "1002952",
        currentStatus: "Acquired",
        inventoryType: "Vacant Land",
        propertyClass: "Residential Land",
        askingPrice: null,
        minimumBid: 7_500,
      }],
      sourceDatasetId: CCLBA_PUBLIC_DATASET_ID,
      sourceUrl: CCLBA_PUBLIC_PORTAL_URL,
      sourceAsOf: null,
      sourceRetrievedAt: RETRIEVED_AT,
    });

    expect(
      normalizeCclbaInventoryAsset(
        {
          ...asset,
          id: 1_234_567,
          currentStatus: "Target - Dlqt Taxes",
          inventoryType: "Vacant Land - Certificate",
        },
        RETRIEVED_AT,
      ),
    ).toMatchObject({
      status: "Target - Dlqt Taxes",
      inventoryType: "Vacant Land - Certificate",
      ownerName: "Unknown",
      ownerType: "unknown",
      ownerJurisdiction: null,
    });
  });

  it("rejects neighboring municipalities and keeps unlocated Chicago rows for source metrics", async () => {
    expect(
      normalizeCclbaInventoryAsset(
        { ...asset, id: 1_100_001, city: "Oak Park" },
        RETRIEVED_AT,
      ),
    ).toBeNull();
    const unlocated = {
      ...asset,
      id: 1_083_837,
      parcelNumber: "25-03-322-036-0000",
      propertyAddress1: "60 E 95TH ST",
      latitude: undefined,
      longitude: undefined,
    };
    expect(
      normalizeCclbaInventoryAsset(unlocated, RETRIEVED_AT),
    ).toBeNull();

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      size: 2,
      rows: [asset, unlocated],
    }), { status: 200 }));
    const snapshot = await fetchCclbaPublicInventory({
      fetchImpl: fetchMock as unknown as typeof fetch,
      pageSize: 2,
      now: () => new Date(RETRIEVED_AT),
    });
    expect(snapshot).toMatchObject({
      expectedCount: 2,
      chicagoCount: 2,
      locatedChicagoCount: 1,
      unlocatedChicagoCount: 1,
    });
    expect(snapshot.assets).toHaveLength(2);
  });

  it("fetches every counted page in stable source-ID order", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        size: 2,
        rows: [{ ...asset, id: 1 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        size: 2,
        rows: [{ ...asset, id: 2 }],
      }), { status: 200 }));

    const snapshot = await fetchCclbaPublicInventory({
      fetchImpl: fetchMock as unknown as typeof fetch,
      pageSize: 1,
      now: () => new Date(RETRIEVED_AT),
    });
    expect(snapshot).toMatchObject({
      expectedCount: 2,
      chicagoCount: 2,
      locatedChicagoCount: 2,
      unlocatedChicagoCount: 0,
      sourceAsOf: null,
      retrievedAt: RETRIEVED_AT,
    });
    expect(snapshot.assets.map((row) => row.id)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(`${firstUrl.origin}${firstUrl.pathname}`).toBe(CCLBA_PUBLIC_API_URL);
    expect(firstUrl.searchParams.get("iDisplayStart")).toBe("0");
    expect(firstUrl.searchParams.get("page")).toBe("1");
    expect(firstUrl.searchParams.get("sort")).toBe(JSON.stringify(CCLBA_STABLE_SORT));
    expect(secondUrl.searchParams.get("iDisplayStart")).toBe("1");
    expect(secondUrl.searchParams.get("page")).toBe("2");
  });

  it("builds deterministic pages and fails closed on count drift or unstable IDs", async () => {
    expect(buildCclbaPublicInventoryPageUrl(250, 250)).toContain("page=2");
    expect(() => buildCclbaPublicInventoryPageUrl(1, 250)).toThrow(
      "complete page",
    );

    const countDrift = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        size: 2,
        rows: [{ ...asset, id: 1 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        size: 3,
        rows: [{ ...asset, id: 2 }],
      }), { status: 200 }));
    await expect(fetchCclbaPublicInventory({
      fetchImpl: countDrift as unknown as typeof fetch,
      pageSize: 1,
    })).rejects.toThrow("count changed during fetch");

    const unstable = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      size: 2,
      rows: [{ ...asset, id: 2 }, { ...asset, id: 1 }],
    }), { status: 200 }));
    await expect(fetchCclbaPublicInventory({
      fetchImpl: unstable as unknown as typeof fetch,
      pageSize: 2,
    })).rejects.toThrow("stable source-ID order");
  });
});
