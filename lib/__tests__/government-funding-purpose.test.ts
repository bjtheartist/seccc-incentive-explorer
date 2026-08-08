import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INVESTMENT_SOURCES,
  type CommunityInvestmentExport,
} from "../community-investment";
import {
  GOVERNMENT_FUNDING_PURPOSES,
  SOURCE_GOVERNMENT_FUNDING_PURPOSE,
  classifyNmtcPurpose,
  governmentFundingPurposeForRecord,
} from "../government-funding-purpose";

describe("government funding purpose", () => {
  it("keeps the source-level mapping exhaustive and separates physical from program funding", () => {
    expect(Object.keys(SOURCE_GOVERNMENT_FUNDING_PURPOSE).sort()).toEqual(
      [...INVESTMENT_SOURCES].sort(),
    );
    expect(
      governmentFundingPurposeForRecord({
        source: "sbif",
        funderType: "government",
      }),
    ).toBe("capital_project");
    expect(
      governmentFundingPurposeForRecord({
        source: "illinois-b2b",
        funderType: "government",
      }),
    ).toBe("programmatic");
    expect(
      governmentFundingPurposeForRecord({
        source: "foundation",
        funderType: "philanthropic",
      }),
    ).toBeNull();
    expect(SOURCE_GOVERNMENT_FUNDING_PURPOSE.nmtc).toBeNull();
  });

  it("uses published CDBG/HOME activity and recipient labels instead of treating the mixed source as one purpose", () => {
    const classify = (logLine: string, recipient: string) =>
      governmentFundingPurposeForRecord({
        source: "cdbg-home",
        funderType: "government",
        logLine,
        recipient,
      });

    expect(classify("CDBG activity · Public Improvements", "Sidewalks")).toBe(
      "capital_project",
    );
    expect(classify("HOME activity · Multifamily Rental", "Rental housing")).toBe(
      "capital_project",
    );
    expect(classify("CDBG activity · Public Services", "Health Services")).toBe(
      "programmatic",
    );
    expect(classify("CDBG activity · Housing", "Code Enforcement")).toBe(
      "programmatic",
    );
    expect(
      classify(
        "CDBG activity · Housing",
        "Rehabilitation: Multi-Unit Residential",
      ),
    ).toBe("capital_project");
    expect(
      classify(
        "CDBG activity · Economic Development",
        "ED Direct: Technical Assistance",
      ),
    ).toBe("programmatic");
    expect(
      classify(
        "CDBG activity · Economic Development",
        "Commercial/Industrial Infrastructure Development",
      ),
    ).toBe("capital_project");
  });

  it("fails closed when a mixed-source description does not match an accepted rule", () => {
    expect(
      governmentFundingPurposeForRecord({
        source: "cdbg-home",
        funderType: "government",
        logLine: "CDBG activity · New category",
        recipient: "Future activity",
      }),
    ).toBe("unclassified");
  });

  it("classifies only all-real-estate NMTC purposes as capital projects", () => {
    expect(
      classifyNmtcPurpose(
        "Real Estate – Construction/Permanent/Acquisition w/o Rehab – Commercial",
      ),
    ).toBe("capital_project");
    expect(
      classifyNmtcPurpose(
        "Real Estate–Rehabilitation–Commercial; Real Estate – Construction–Housing-Multi Family",
      ),
    ).toBe("capital_project");
    expect(classifyNmtcPurpose("Business Financing")).toBe("unclassified");
    expect(
      classifyNmtcPurpose(
        "Real Estate–Rehabilitation–Commercial; Business Financing",
      ),
    ).toBe("unclassified");
    expect(classifyNmtcPurpose(null)).toBe("unclassified");
  });

  it("classifies every CDBG/HOME row in the accepted committed snapshot", () => {
    const investment = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "private", "community-investment.json"),
        "utf8",
      ),
    ) as CommunityInvestmentExport;
    const cdbgHome = investment.records.filter(
      (record) => record.source === "cdbg-home",
    );

    expect(cdbgHome).toHaveLength(6_082);
    expect(cdbgHome.filter((record) => record.governmentFundingPurpose === "unclassified")).toEqual([]);
    expect(
      cdbgHome.filter((record) => record.governmentFundingPurpose === "capital_project"),
    ).toHaveLength(675);
    expect(
      cdbgHome.filter((record) => record.governmentFundingPurpose === "programmatic"),
    ).toHaveLength(5_407);
    expect(
      new Set(cdbgHome.map((record) => record.governmentFundingPurpose)),
    ).toEqual(new Set(["capital_project", "programmatic"]));
  });

  it("persists one valid purpose on every government row and null on every non-government row", () => {
    const investment = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "private", "community-investment.json"),
        "utf8",
      ),
    ) as CommunityInvestmentExport;
    const valid = new Set(GOVERNMENT_FUNDING_PURPOSES);

    expect(
      investment.records.filter(
        (record) =>
          record.funderType === "government" &&
          !valid.has(record.governmentFundingPurpose as (typeof GOVERNMENT_FUNDING_PURPOSES)[number]),
      ),
    ).toEqual([]);
    expect(
      investment.records.filter(
        (record) =>
          record.funderType !== "government" &&
          record.governmentFundingPurpose !== null,
      ),
    ).toEqual([]);
  });

  it("reconciles the accepted NMTC snapshot without treating financing-only or mixed rows as capital", () => {
    const investment = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "private", "community-investment.json"),
        "utf8",
      ),
    ) as CommunityInvestmentExport;
    const nmtc = investment.records.filter((record) => record.source === "nmtc");

    expect(nmtc).toHaveLength(177);
    expect(
      nmtc.filter((record) => record.governmentFundingPurpose === "capital_project"),
    ).toHaveLength(112);
    expect(
      nmtc.filter((record) => record.governmentFundingPurpose === "unclassified"),
    ).toHaveLength(65);
  });
});
