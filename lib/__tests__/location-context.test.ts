import { describe, expect, it } from "vitest";
import { buildLocationContext, LOCATION_CONTEXT_VERSION, publicParcelContext } from "../location-context";
import type { ParcelData, Program } from "../types";

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: "tif",
    name: "TIF Program",
    level: "City",
    zoneKey: "tif",
    summary: "A test program",
    whoQualifies: "Businesses in the matching zone",
    benefits: ["Grant"],
    howToApply: ["Confirm program fit"],
    requiredDocs: ["Project budget"],
    contact: "test@example.com",
    url: "https://example.com/program",
    eligibilityRules: [
      {
        criterion: "location",
        description: "Must be in a TIF district",
        verifiedBy: "location",
        required: true,
      },
    ],
    lastVerifiedAt: new Date().toISOString(),
    benefitRange: "$10K-$50K",
    fastestConfirmingStep: "Call the program administrator",
    ...overrides,
  };
}

const parcel: ParcelData = {
  pin: "20363070290000",
  address: "100 E Test St",
  classCode: "5-17",
  classDescription: "One-story commercial building",
  taxCode: "70001",
  township: "Hyde Park",
  landSqft: 3_000,
  bldgSqft: 2_000,
  bldgAge: 40,
  landValue: "$40,000",
  bldgValue: "$120,000",
  totalValue: "$160,000",
  parcelType: null,
  isCommercial: true,
  isIndustrial: false,
  isVacant: false,
  ownerName: "Sensitive Owner LLC",
  ownerMailingAddress: "123 Private Mailbox",
  ownerType: "llc",
};

describe("buildLocationContext", () => {
  it("creates source-backed claims across location, programs, site signals, and support resources", () => {
    const context = buildLocationContext(
      {
        reportType: "site-incentives",
        address: "100 E Test St",
        lat: 41.8,
        lon: -87.6,
        industry: "food",
      },
      [makeProgram()],
      {
        zones: { tif: true, sbif: false },
        zoneNames: { tif: "Test TIF" },
        parcel,
        siteSignals: {
          nofAwardsNearby: 2,
          incentiveParcelsNearby: 1,
          brownfield: { name: "Former industrial site", miles: 0.4 },
          openLustNearby: 1,
          nearestOpenLust: { name: "Open LUST incident", miles: 0.2 },
          nearestIncentiveParcel: { name: "Class 7b parcel", miles: 0.1 },
        },
        transport: {
          expressway: { name: "I-90", miles: 1.2 },
          rail: { name: "NS Chicago Line", miles: 0.3 },
          midwayMiles: 8.7,
          ohareMiles: 19.1,
        },
        localBusinessSupport: {
          communityAreaNumber: "46",
          communityArea: "South Chicago",
          organizations: [
            {
              name: "Southeast Chicago Chamber",
              relationships: ["primary_access_point"],
              sourceUrls: ["https://example.com/support"],
            },
          ],
          sourceLabel: "Validated support-resource workbook",
          sourceUrls: ["https://example.com/support"],
        },
      }
    );

    expect(context.version).toBe(LOCATION_CONTEXT_VERSION);
    expect(context.posture).toBe("internal");
    expect(context.geography.zones.value).toEqual(["tif"]);
    expect(context.geography.zones.kind).toBe("measured");
    expect(context.programs.topMatches.map((result) => result.programId)).toContain("tif");
    expect(context.site.siteSignals?.kind).toBe("proximity");
    expect(context.site.transport?.kind).toBe("proximity");
    expect(context.neighborhood.localSupport?.kind).toBe("partner_verified");
    expect(context.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining(["zones", "programs", "parcel", "siteSignals", "transport", "localBusinessSupport"])
    );
  });

  it("removes owner names and mailing addresses from the public parcel context", () => {
    const context = buildLocationContext(
      { reportType: "site-incentives", address: "100 E Test St" },
      [makeProgram()],
      { zones: { tif: true }, zoneNames: { tif: "Test TIF" }, parcel }
    );

    expect(context.geography.parcel?.value).toMatchObject({
      pin: parcel.pin,
      ownerType: "llc",
    });
    expect(context.geography.parcel?.value).not.toHaveProperty("ownerName");
    expect(context.geography.parcel?.value).not.toHaveProperty("ownerMailingAddress");
    expect(context.trust.caveats.join(" ")).toContain("Sensitive owner-level");
  });

  it("uses the shared parcel sanitizer for fallback report paths", () => {
    const safeParcel = publicParcelContext(parcel);

    expect(safeParcel).toMatchObject({
      pin: parcel.pin,
      ownerType: "llc",
    });
    expect(safeParcel).not.toHaveProperty("ownerName");
    expect(safeParcel).not.toHaveProperty("ownerMailingAddress");
  });

  it("uses the source returned by a successful zoning lookup", () => {
    const context = buildLocationContext(
      { reportType: "site-incentives", address: "100 E Test St" },
      [makeProgram()],
      {
        zones: { tif: true },
        cityZoning: {
          status: "available",
          zoneClass: "B3-2",
          zoneType: null,
          source: {
            id: "chicago-data-portal-zoning",
            label: "City of Chicago Data Portal zoning boundaries",
            url: "https://data.cityofchicago.org/d/dj47-wfun",
            retrievedAt: "2026-08-08T12:00:00.000Z",
            recordUpdatedAt: "2025-03-05T00:00:00.000Z",
          },
        },
      },
    );

    expect(context.geography.cityZoning).toMatchObject({
      kind: "measured",
      sourceIds: ["zoning"],
      freshness: "2025-03-05T00:00:00.000Z",
    });
    expect(context.geography.cityZoning?.caveat).toContain(
      "does not determine whether a proposed use is permitted",
    );
    expect(context.sources.find((source) => source.id === "zoning")).toMatchObject({
      label: "City of Chicago Data Portal zoning boundaries",
      url: "https://data.cityofchicago.org/d/dj47-wfun",
      freshness: "Source record updated 2025-03-05",
    });
  });

  it("keeps an unavailable zoning lookup out of measured source claims", () => {
    const context = buildLocationContext(
      { reportType: "site-incentives", address: "100 E Test St" },
      [makeProgram()],
      {
        zones: { tif: true },
        cityZoning: {
          status: "unavailable",
          zoneClass: null,
          zoneType: null,
          source: null,
          message: "Published Chicago zoning data is temporarily unavailable.",
        },
      },
    );

    expect(context.geography.cityZoning).toMatchObject({
      kind: "needs_verification",
      sourceIds: [],
    });
    expect(context.geography.cityZoning?.caveat).toContain(
      "no zoning conclusion is shown",
    );
    expect(context.sources.some((source) => source.id === "zoning")).toBe(false);
  });
});
