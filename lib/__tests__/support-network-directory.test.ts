import { describe, expect, it } from "vitest";
import citywideSupportData from "@/data/curated/citywide_business_support_resources.json";
import capitalPartnerData from "@/data/curated/capital_partners.json";
import { supportNetworkDirectory } from "@/lib/support-network-directory";

describe("support network directory", () => {
  it("includes the requested local, capital, housing, and development organizations", () => {
    const names = supportNetworkDirectory.organizations.map((organization) => organization.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "Greenwood Archer Capital",
        "Chicago Neighborhood Initiatives",
        "Far South Community Development Corporation",
        "Greater Southwest Development Corporation",
        "The Resurrection Project",
        "Neighborhood Housing Services of Chicago",
        "Emerald South Economic Development Collaborative",
        "LISC Chicago",
        "IFF",
        "Chicago Community Loan Fund",
        "South Side Community Economic Development Center",
      ])
    );
  });

  it("uses unique organization identifiers and names", () => {
    const ids = supportNetworkDirectory.organizations.map((organization) => organization.id);
    const names = supportNetworkDirectory.organizations.map((organization) => organization.name);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps every named contact tied to an official source and current role", () => {
    for (const organization of supportNetworkDirectory.organizations) {
      expect(organization.publicIntake.url).toMatch(/^https:\/\//);
      expect(organization.sourceUrls.length).toBeGreaterThan(0);
      expect(organization.lastVerifiedAt).toBe("2026-07-14");

      for (const contact of organization.keyContacts) {
        expect(contact.name.trim()).not.toBe("");
        expect(contact.role.trim()).not.toBe("");
        expect(contact.sourceUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it("holds unconfirmed service areas out of public routing", () => {
    const justine = supportNetworkDirectory.organizations.find(
      (organization) => organization.id === "justine-petersen"
    );
    const publicNames = [
      ...capitalPartnerData.partners.map((partner) => partner.name),
      ...citywideSupportData.organizations.map((organization) => organization.name),
    ];

    expect(justine?.coverageRole).toBe("verification_needed");
    expect(justine?.relationshipStatus).toBe("service_area_check_needed");
    expect(publicNames).not.toContain("Justine PETERSEN");
  });
});
