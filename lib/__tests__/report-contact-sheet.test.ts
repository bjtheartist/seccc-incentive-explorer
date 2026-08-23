import { describe, expect, it } from "vitest";
import { buildContactSheetRows } from "@/lib/report-contact-sheet";
import { CONFIRMED_PROGRAMS_SECTION_TITLE } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";
import { SUPPORT_ORGANIZATIONS_SECTION_TITLE } from "@/lib/support-organization-copy";

function reportFixture(): GeneratedReport {
  return {
    title: "Location Snapshot",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-08-01T00:00:00.000Z",
    summary: "",
    sections: [
      {
        title: CONFIRMED_PROGRAMS_SECTION_TITLE,
        description: "",
        items: [
          {
            label: "SBIF",
            value: "",
            programId: "sbif",
            url: "https://example.com/sbif",
            sourceLabel: "sbif@somercor.com",
          },
        ],
      },
      {
        title: SUPPORT_ORGANIZATIONS_SECTION_TITLE,
        description: "",
        items: [
          { label: "Local Support in South Chicago", value: "3 organizations" },
          {
            label: "Chicago SBDC",
            value: "Advising",
            detail: "SBDC technical assistance and counseling",
            url: "https://example.com/sbdc",
          },
          {
            label: "Greenwood Archer Capital",
            value: "CDFI lender",
            detail: "revenue-based loans",
            url: "https://example.com/gac",
          },
          // No lane inference will match anything here for "starting" — no
          // derivable why-line, so this must NOT make the sheet.
          { label: "Mystery Org With No Type Signal", value: "" },
        ],
      },
    ],
    recommendedActions: [],
    metadata: { address: "9101 S Commercial Ave" },
    capitalPartnerHandoff: {
      primary: {
        partnerId: "gac",
        name: "Greenwood Archer Capital",
        partnerType: "cdfi",
        phone: "312-555-0100",
        reason: "Matches your commercial real estate financing need.",
        provenance: { verificationTier: "current", verifiedAt: "2026-08-01" },
      },
      alternates: [],
    },
  } as unknown as GeneratedReport;
}

describe("buildContactSheetRows", () => {
  it("includes the capital-partner primary with its own required `reason` as the why-line", () => {
    const rows = buildContactSheetRows(reportFixture(), "developer");
    const financing = rows.find((r) => r.kind === "financing");
    expect(financing).toBeDefined();
    expect(financing?.whyLine).toBe("Matches your commercial real estate financing need.");
    expect(financing?.detail).toBe("312-555-0100");
  });

  it("includes visible program contacts with a factual, non-eligibility why-line", () => {
    const rows = buildContactSheetRows(reportFixture(), "starting");
    const program = rows.find((r) => r.kind === "program");
    expect(program).toBeDefined();
    expect(program?.whyLine).toBe("Administers SBIF.");
    expect(program?.whyLine).not.toMatch(/qualify|eligible/i);
  });

  it("keeps each organization in one resource category and excludes support-org rows without a derivable why-line", () => {
    // "developer"'s lane preference (property_community_development,
    // capital_readiness, small_business_capital) does NOT include
    // business_navigation — the fallback lane `inferSupportLanes` assigns
    // any org it can't otherwise classify. Greenwood Archer Capital (a named
    // CDFI lender) matches capital_readiness for real; the untyped org only
    // ever gets the generic fallback, which is not evidence of relevance to
    // THIS persona and must not produce a why-line.
    const rows = buildContactSheetRows(reportFixture(), "developer");
    const orgNames = rows.filter((r) => r.kind === "organization").map((r) => r.name);
    // Greenwood Archer is already the selected financial resource, so it is
    // not duplicated into the community-resource group.
    expect(orgNames).not.toContain("Greenwood Archer Capital");
    expect(rows.filter((row) => row.name === "Greenwood Archer Capital")).toHaveLength(1);
    expect(rows.find((row) => row.name === "Greenwood Archer Capital")?.kind).toBe("financing");
    expect(orgNames).not.toContain("Mystery Org With No Type Signal");
    expect(orgNames).not.toContain("Local Support in South Chicago"); // the summary head, not a contact
  });

  it("never lists a program that fell outside the visible (goal-matched ∩ persona-tagged) set — reads the already-lensed report, never re-derives relevance", () => {
    const lensed: GeneratedReport = {
      ...reportFixture(),
      sections: [
        {
          title: "Also at this address",
          description: "",
          collapsedByPersona: true,
          items: [{ label: "TIF", value: "", programId: "tif", url: "https://example.com/tif" }],
        },
      ],
    };
    const rows = buildContactSheetRows(lensed, "developer");
    expect(rows.some((r) => r.name === "TIF")).toBe(false);
  });

  it("returns an empty list (never a fabricated row) when nothing has a derivable why-line", () => {
    const bare: GeneratedReport = {
      ...reportFixture(),
      sections: [],
      capitalPartnerHandoff: undefined,
    };
    expect(buildContactSheetRows(bare, "developer")).toEqual([]);
  });
});
