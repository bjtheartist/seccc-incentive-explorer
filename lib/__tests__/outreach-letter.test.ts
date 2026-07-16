import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateOutreachLetterBase64, VERIFICATION_DISCLAIMER } from "../outreach-letter";
import type { ParcelProgramContext } from "../owner-file-letter-context";

const verifiedInput = {
  ownerName: "U S STEEL",
  ownerMailingAddress: "600 GRANT ST #1381, PITTSBURGH, PA, 15219",
  corridorManagerName: "Jane Corridor Manager",
  corridorManagerContact: "jane@example.org — (773) 555-0100",
  zip: "60617",
  clusterKey: "mail:600grantst1381pittsburghpa15219",
  verificationStatus: "verified",
  parcelProgramContext: [
    {
      address: "8232 S BURLEY AVE",
      lat: 41.7405,
      lon: -87.5457,
      programs: [
        {
          id: "nof",
          name: "Neighborhood Opportunity Fund (NOF)",
          level: "City",
          url: "https://www.chicago.gov/nof",
          summary: "Commercial/industrial building rehab grant.",
        },
      ],
      resolutionNote: null,
    },
    {
      address: "8236 S MACKINAW AVE",
      lat: null,
      lon: null,
      programs: [],
      resolutionNote: "Address could not be located for zone matching.",
    },
  ] satisfies ParcelProgramContext[],
};

describe("VERIFICATION_DISCLAIMER", () => {
  it("matches the locked verification copy verbatim from app/programs/page.tsx", () => {
    const source = readFileSync(join(__dirname, "..", "..", "app", "programs", "page.tsx"), "utf8");
    expect(source).toContain(VERIFICATION_DISCLAIMER);
  });
});

describe("generateOutreachLetterBase64", () => {
  it("refuses to build a letter for an unverified Owner File", () => {
    expect(() =>
      generateOutreachLetterBase64({ ...verifiedInput, verificationStatus: "draft" })
    ).toThrow(/verified/i);
  });

  it("builds a base64 PDF for a verified Owner File", () => {
    const result = generateOutreachLetterBase64(verifiedInput);
    expect(result.filename).toMatch(/^outreach-letter-.*\.pdf$/);
    expect(result.base64.length).toBeGreaterThan(100);
  });

  it("degrades gracefully when a parcel has no matched programs", () => {
    const result = generateOutreachLetterBase64({
      ...verifiedInput,
      parcelProgramContext: [
        { address: "1 UNKNOWN ST", lat: null, lon: null, programs: [], resolutionNote: "Program lookup failed for this parcel." },
      ],
    });
    expect(result.base64.length).toBeGreaterThan(100);
  });
});
