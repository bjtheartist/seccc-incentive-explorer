/**
 * build-spec.md PR-A item 1/2/6 (F1) — the PDF adapter used to recover a
 * site-index row's PIN by re-joining `edition.sitePoints` on `${lat},${lon}`.
 * That join is a last-write-wins `Map`, so when several sitePoints share a
 * site-index row's exact coordinate, whichever one was written LAST into the
 * map silently wins — even when it names a different parcel. Real failing
 * case (60651, siteIndex[8]): 3232 W DIVISION ST carries its own
 * `pin: "16022280270000"`, but four co-located sitePoints (270000/300000/
 * 290000/280000, in that array order) used to resolve the row's link to
 * 16022280280000 instead — a wrong-parcel link a corridor manager could act
 * on. The fix deletes the coordinate join entirely and reads `row.pin`
 * directly (VacancySiteIndexRow already carries it — see vacancy-index.ts).
 */
import { describe, expect, it } from "vitest";
import { buildVacancyIndexPdfInput } from "../vacancy-index-adapter";
import { cookViewerUrl, clerkRecordsUrl } from "../cook-viewer";
import type { VacancyIndexExport } from "../vacancy-index";

const ROW_PIN = "16022280270000";
const COLOCATED_WRONG_PIN = "16022280280000";
// Same coordinate, four distinct parcels — order matters: the wrong pin is
// deliberately LAST so a coordinate-keyed Map (last write wins) would surface
// it instead of the row's own pin.
const SHARED_LAT = 41.899;
const SHARED_LON = -87.71;

function makeExport(): VacancyIndexExport {
  return {
    generatedAt: "2026-08-13T00:00:00.000Z",
    sources: {
      trackedInventory: "src-a",
      vacantLandOwnership: "src-b",
      corridorMetrics: "src-c",
      zipBoundaries: "src-d",
      transportNetwork: "src-e",
      asOf: "2026-08-13",
    },
    matrix: [],
    editions: {
      "60651": {
        zip: "60651",
        neighborhood: "Austin",
        secondaryAreas: [],
        editionNumber: 4,
        headline: {
          vacantPropertyCount: 20,
          vacantLandCount: 8,
          vacantBuildingCount: 12,
          cityOwnedCount: 5,
          inIncentiveZoneCount: 20,
        },
        ownership: {
          vacantLandParcelsByOwnerType: null,
          vacantLandParcelTotal: null,
          trackedInventoryByOwnerType: [],
          reconciledVacantLandByOwnerType: null,
          reconciliation: null,
          structureBreakdown: null,
        },
        distress: null,
        exemptionAnomalies: null,
        boundary: null,
        centroid: { lat: SHARED_LAT, lon: SHARED_LON },
        transport: [],
        siteIndex: [
          {
            markerNumber: 9,
            address: "3232 W DIVISION ST",
            ownerType: "local_private",
            propertyType: "vacant_building",
            zoningClass: "B3-2",
            squareFeet: 2400,
            incentiveCount: 1,
            nextStep: "Verify ownership",
            lat: SHARED_LAT,
            lon: SHARED_LON,
            pin: ROW_PIN,
            ownerStructure: "llc",
            ownerGeography: "in_state",
          },
        ],
        sitePoints: [
          // Deliberately in this order — the wrong pin (280000) is last, so
          // the deleted `Map(sitePoints.map(p => [coord, p]))` join would have
          // resolved to it.
          { lat: SHARED_LAT, lon: SHARED_LON, pin: ROW_PIN, ownerType: "local_private", propertyType: "vacant_building", markerNumber: 9, address: "3232 W DIVISION ST", squareFeet: 2400, zoningClass: "B3-2", incentiveCount: 1, ownerConfidence: "pin_matched", clusterId: null, saleYear: null, violation: false, ownerStructure: "llc", ownerGeography: "in_state", pinMatch: "inventory" },
          { lat: SHARED_LAT, lon: SHARED_LON, pin: "16022280300000", ownerType: "local_private", propertyType: "vacant_building", markerNumber: null, address: "3230 W DIVISION ST", squareFeet: 2400, zoningClass: "B3-2", incentiveCount: 1, ownerConfidence: "pin_matched", clusterId: null, saleYear: null, violation: false, ownerStructure: "llc", ownerGeography: "in_state", pinMatch: "inventory" },
          { lat: SHARED_LAT, lon: SHARED_LON, pin: "16022280290000", ownerType: "local_private", propertyType: "vacant_building", markerNumber: null, address: "3228 W DIVISION ST", squareFeet: 2400, zoningClass: "B3-2", incentiveCount: 1, ownerConfidence: "pin_matched", clusterId: null, saleYear: null, violation: false, ownerStructure: "llc", ownerGeography: "in_state", pinMatch: "inventory" },
          { lat: SHARED_LAT, lon: SHARED_LON, pin: COLOCATED_WRONG_PIN, ownerType: "local_private", propertyType: "vacant_building", markerNumber: null, address: "3226 W DIVISION ST", squareFeet: 2400, zoningClass: "B3-2", incentiveCount: 1, ownerConfidence: "pin_matched", clusterId: null, saleYear: null, violation: false, ownerStructure: "llc", ownerGeography: "in_state", pinMatch: "inventory" },
        ],
        sitePointsTruncated: false,
        landPoints: null,
        landPointsTruncated: false,
        landPointsTotal: null,
        directoryCount: 0,
        buildingPinMatch: null,
        clusters: [],
        clustersNote: "",
        corridors: [],
        anchors: null,
      },
    },
  } as unknown as VacancyIndexExport;
}

describe("buildVacancyIndexPdfInput — topSites.pin comes from the row, never a coordinate join (F1)", () => {
  it("uses the site-index row's OWN pin even when other sitePoints share its exact coordinate", () => {
    const input = buildVacancyIndexPdfInput(makeExport(), "60651");
    expect(input).not.toBeNull();
    const topSite = input!.topSites.find((s) => s.address === "3232 W DIVISION ST");
    expect(topSite).toBeDefined();
    expect(topSite!.pin).toBe(ROW_PIN);
    expect(topSite!.pin).not.toBe(COLOCATED_WRONG_PIN);
  });

  it("the PDF's CookViewer / Clerk links resolve from that same correct pin, never the co-located neighbor", () => {
    const input = buildVacancyIndexPdfInput(makeExport(), "60651");
    const topSite = input!.topSites.find((s) => s.address === "3232 W DIVISION ST")!;

    const cookViewer = cookViewerUrl(topSite.pin);
    const clerk = clerkRecordsUrl(topSite.pin);

    expect(cookViewer).toContain(ROW_PIN);
    expect(clerk).toContain(ROW_PIN);
    expect(cookViewer).not.toContain(COLOCATED_WRONG_PIN);
    expect(clerk).not.toContain(COLOCATED_WRONG_PIN);
  });
});
