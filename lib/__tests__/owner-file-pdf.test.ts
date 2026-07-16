import { describe, expect, it } from "vitest";
import { generateOwnerFileDossierPdfBase64 } from "../owner-file-pdf";
import type { OwnerCluster } from "../corridor-owners";
import type { OwnerFile } from "../owner-file";

const cluster: OwnerCluster = {
  clusterKey: "mail:600grantst1381pittsburghpa15219",
  pins: ["17111000010000", "17111000020000"],
  ownerName: "U S STEEL",
  ownerMailingAddress: "600 GRANT ST #1381, PITTSBURGH, PA, 15219",
  ownerType: "out_of_state",
  parcelCount: 43,
  vacantParcelCount: 43,
  businessCount: 0,
  businessNames: [],
  sampleAddresses: ["8232 S BURLEY AVE", "8236 S MACKINAW AVE"],
  latestTransferDate: "2025-09-23T05:00:00.000Z",
  latestBuyerName: "RELATED CHICAGO 8080 LLC",
  latestSellerName: "CLD ADJOINING RESIDENTIAL PARCELS, LLC",
  confidence: "High",
  evidence: "grouped by recorded owner mailing address",
  distressSignals: {
    buildingViolationCount: 3,
    vacantBuildingViolationCount: null,
    delinquentTaxCount: null,
    scavengerOrAnnualSaleFlag: null,
    cclbaInventoryFlag: null,
  },
};

function ownerFile(overrides: Partial<OwnerFile> = {}): OwnerFile {
  return {
    cluster,
    verification: null,
    notes: [],
    outreachEvents: [],
    resolvedTier: "B",
    ...overrides,
  };
}

describe("generateOwnerFileDossierPdfBase64", () => {
  it("builds a dossier PDF for an unverified cluster (draft-only)", () => {
    const result = generateOwnerFileDossierPdfBase64(ownerFile());
    expect(result.filename).toMatch(/^owner-file-.*\.pdf$/);
    expect(result.base64.length).toBeGreaterThan(100);
  });

  it("builds a dossier PDF including a verified record, notes, and outreach history", () => {
    const now = new Date().toISOString();
    const result = generateOwnerFileDossierPdfBase64(
      ownerFile({
        resolvedTier: "A",
        verification: {
          id: "v1",
          clusterKey: cluster.clusterKey,
          zip: "60617",
          pinsSnapshot: cluster.pins,
          ownerNameSnapshot: cluster.ownerName,
          ownerMailingAddressSnapshot: cluster.ownerMailingAddress,
          exportGeneratedAt: now,
          verifierName: "Jane Corridor Manager",
          confidenceTier: "A",
          registeredAgentName: "CT Corporation System",
          registeredAgentAddress: "208 S LASALLE ST, CHICAGO, IL",
          ilSosFileNumber: "65432100",
          ilSosLookupUrl: "https://apps.ilsos.gov/businessentitysearch/",
          taxpayerMailingAddressConfirmed: true,
          localVsAbsentee: "absentee",
          checklist: [{ id: "c1", label: "Confirm entity standing", completed: true }],
          status: "verified",
          createdAt: now,
          updatedAt: now,
        },
        notes: [
          {
            id: "n1",
            clusterKey: cluster.clusterKey,
            zip: "60617",
            authorName: "Jane Corridor Manager",
            noteType: "entity_lookup",
            body: "Verified via individual IL SOS lookup.",
            sourceUrl: "https://apps.ilsos.gov/businessentitysearch/",
            createdAt: now,
          },
        ],
        outreachEvents: [
          {
            id: "e1",
            clusterKey: cluster.clusterKey,
            zip: "60617",
            verificationId: "v1",
            eventType: "letter_generated",
            actorName: "Jane Corridor Manager",
            programIds: ["nof"],
            outcome: null,
            notes: null,
            occurredAt: now,
          },
        ],
      })
    );
    expect(result.base64.length).toBeGreaterThan(100);
  });

  it("renders 'not yet available' distress fields as literal nulls, never a silent zero", () => {
    const nullDistressCluster: OwnerCluster = {
      ...cluster,
      distressSignals: {
        buildingViolationCount: null,
        vacantBuildingViolationCount: null,
        delinquentTaxCount: null,
        scavengerOrAnnualSaleFlag: null,
        cclbaInventoryFlag: null,
      },
    };
    const result = generateOwnerFileDossierPdfBase64(ownerFile({ cluster: nullDistressCluster }));
    expect(result.base64.length).toBeGreaterThan(100);
  });
});
