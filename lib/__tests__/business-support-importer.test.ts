import { describe, expect, it } from "vitest";
import {
  applyVerifiedLocalBusinessSupportOverride,
  type LocalBusinessSupportOrganization,
} from "@/lib/local-business-support";

describe("business support workbook importer", () => {
  it("reapplies the verified Greater Englewood public contact over stale workbook values", () => {
    const staleRecord: LocalBusinessSupportOrganization = {
      id: "P019",
      name: "Greater Englewood Chamber Foundation",
      relationships: ["secondary_access_point"],
      address: "815 W. 63rd St., Fl. 2, Chicago, IL 60621",
      phone: "312.768.8573",
      website: "https://www.gechamber.com",
      validationLevel: "Needs current validation",
      currentStatus: "Baseline/Verify",
      sourceYear: "2021 baseline",
      sourceUrls: ["https://example.org/legacy-source"],
    };

    const updated = applyVerifiedLocalBusinessSupportOverride(staleRecord);

    expect(updated).toMatchObject({
      address: "825 W. 69th St., 2nd Floor, Chicago, IL 60621",
      phone: "312-768-8573",
      email: "connect@geccf.org",
      website: "https://www.gechamber.com/contactus",
      validationLevel: "Verified: official organization contact page",
      currentStatus: "Active public intake",
      sourceYear: "2026",
      lastVerifiedAt: "2026-08-07",
    });
    expect(updated.relationships).toEqual(["secondary_access_point"]);
    expect(updated.sourceUrls).toEqual([
      "https://example.org/legacy-source",
      "https://www.gechamber.com/contactus",
    ]);
  });

  it("does not alter unrelated provider records", () => {
    const unrelated: LocalBusinessSupportOrganization = {
      id: "P999",
      name: "Another Organization",
      relationships: ["primary_access_point"],
      sourceUrls: ["https://example.org/source"],
    };

    expect(applyVerifiedLocalBusinessSupportOverride(unrelated)).toBe(unrelated);
  });
});
