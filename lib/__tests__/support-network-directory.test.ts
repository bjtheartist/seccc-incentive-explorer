import { describe, expect, it } from "vitest";
import citywideSupportData from "@/data/curated/citywide_business_support_resources.json";
import capitalPartnerData from "@/data/curated/capital_partners.json";
import { supportNetworkDirectory } from "@/lib/support-network-directory";
import { SUPPORT_VERIFICATION_GUIDE } from "@/lib/support-organization-copy";

describe("support network directory", () => {
  it("distinguishes source checks from current intake capacity", () => {
    expect(SUPPORT_VERIFICATION_GUIDE.map((item) => item.label)).toEqual([
      "Listed in a current official source",
      "Official website checked",
      "Public intake recently confirmed",
      "Current capacity not confirmed",
    ]);
    expect(SUPPORT_VERIFICATION_GUIDE[0].description).toContain("not current intake");
    expect(SUPPORT_VERIFICATION_GUIDE[1].description).toContain("not that a program is open");
    expect(SUPPORT_VERIFICATION_GUIDE[2].description).toContain("response is guaranteed");
    expect(SUPPORT_VERIFICATION_GUIDE[3].description).toContain("capacity is unknown");
  });

  it("includes the requested local, capital, housing, and development organizations", () => {
    const names = supportNetworkDirectory.organizations.map((organization) => organization.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "Greenwood Archer Capital",
        "Chicago Neighborhood Initiatives",
        "Far South Community Development Corporation",
        "Greater Englewood Chamber Foundation",
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
    expect(supportNetworkDirectory.generatedAt).toBe("2026-08-07");

    for (const organization of supportNetworkDirectory.organizations) {
      expect(organization.publicIntake.url).toMatch(/^https:\/\//);
      expect(organization.sourceUrls.length).toBeGreaterThan(0);
      expect(Date.parse(`${organization.lastVerifiedAt}T00:00:00.000Z`)).not.toBeNaN();
      expect(organization.lastVerifiedAt <= supportNetworkDirectory.generatedAt).toBe(true);

      for (const contact of organization.keyContacts) {
        expect(contact.name.trim()).not.toBe("");
        expect(contact.role.trim()).not.toBe("");
        expect(contact.sourceUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it("publishes Greater Englewood organization-level intake without personal contacts", () => {
    const greaterEnglewood = supportNetworkDirectory.organizations.find(
      (organization) => organization.id === "greater-englewood-chamber-foundation"
    );

    expect(greaterEnglewood).toMatchObject({
      name: "Greater Englewood Chamber Foundation",
      publicIntake: {
        email: "connect@geccf.org",
        phone: "312-768-8573",
        url: "https://www.gechamber.com/contactus",
      },
      keyContacts: [],
      lastVerifiedAt: "2026-08-07",
      sourceUrls: ["https://www.gechamber.com/contactus"],
    });
  });

  it("tracks current public program verification without repository-held relationship notes", () => {
    const justine = supportNetworkDirectory.organizations.find(
      (organization) => organization.id === "justine-petersen"
    );
    const publicNames = [
      ...capitalPartnerData.partners.map((partner) => partner.name),
      ...citywideSupportData.organizations.map((organization) => organization.name),
    ];

    expect(justine?.coverageRole).toBe("regional_option");
    expect(justine?.sourceUrls).toContain(
      "https://www.sba.gov/funding-programs/loans/microloans/list-microlenders"
    );
    expect(publicNames).toContain("Justine PETERSEN");

    const serialized = JSON.stringify(supportNetworkDirectory);
    expect(serialized).not.toContain("relationshipStatus");
    expect(serialized).not.toContain("chamberNextStep");
    for (const organization of supportNetworkDirectory.organizations) {
      for (const contact of organization.keyContacts) {
        expect(contact).not.toHaveProperty("email");
        expect(contact).not.toHaveProperty("phone");
      }
    }
  });
});
