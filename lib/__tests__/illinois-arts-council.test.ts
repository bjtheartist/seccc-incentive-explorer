import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IAC_PROGRAMS,
  IAC_SOURCE_EXPECTATIONS,
  parseCuratedIllinoisArtsCouncilAwards,
  parseIllinoisArtsCouncilSource,
  serializeIllinoisArtsCouncilAwards,
} from "../illinois-arts-council";
import { parseDelimited } from "../../scripts/export-community-investment";

const INPUT_DIR = join(process.cwd(), "data", "curated", "investment-inputs");
const SOURCE_PATH = join(
  INPUT_DIR,
  "illinois_arts_council_fy26_q1_source.json",
);
const CHICAGO_PATH = join(
  INPUT_DIR,
  "illinois_arts_council_fy26_q1_chicago.csv",
);

describe("Illinois Arts Council FY2026 Q1 source", () => {
  it("reconciles the official table and all four program summaries", () => {
    const parsed = parseIllinoisArtsCouncilSource(
      readFileSync(SOURCE_PATH, "utf8"),
      "2026-08-08",
    );

    expect(parsed.awards).toHaveLength(IAC_SOURCE_EXPECTATIONS.awardRows);
    expect(parsed.summaries).toHaveLength(IAC_SOURCE_EXPECTATIONS.summaryRows);
    expect(
      parsed.awards.reduce((sum, award) => sum + award.grantAmount, 0),
    ).toBe(IAC_SOURCE_EXPECTATIONS.awardDollars);
    for (const program of IAC_PROGRAMS) {
      expect(parsed.summaries.some((summary) => summary.program === program)).toBe(true);
    }
  });

  it("reproduces the committed Chicago subset byte for byte", () => {
    const parsed = parseIllinoisArtsCouncilSource(
      readFileSync(SOURCE_PATH, "utf8"),
      "2026-08-08",
    );
    const committed = readFileSync(CHICAGO_PATH, "utf8");
    const rows = parseDelimited(committed, ",");
    const curated = parseCuratedIllinoisArtsCouncilAwards(rows);

    expect(serializeIllinoisArtsCouncilAwards(parsed.chicagoAwards)).toBe(committed);
    expect(curated).toEqual(parsed.chicagoAwards);
    expect(curated).toHaveLength(IAC_SOURCE_EXPECTATIONS.chicagoRows);
    expect(
      curated.reduce((sum, award) => sum + award.grantAmount, 0),
    ).toBe(IAC_SOURCE_EXPECTATIONS.chicagoAwardDollars);
    expect(curated.every((award) => award.city === "Chicago")).toBe(true);
  });

  it("does not manufacture address or official-id fields", () => {
    const parsed = parseIllinoisArtsCouncilSource(
      readFileSync(SOURCE_PATH, "utf8"),
      "2026-08-08",
    );
    for (const award of parsed.chicagoAwards) {
      expect(award).not.toHaveProperty("address");
      expect(award).not.toHaveProperty("postalCode");
      expect(award).not.toHaveProperty("lat");
      expect(award).not.toHaveProperty("lng");
      expect(award).not.toHaveProperty("officialAwardId");
      expect(award.recordId).toMatch(/^iac-fy26-q1-row-\d{4}$/);
    }
  });

  it("fails closed on source-row, amount, and summary drift", () => {
    const source = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));

    expect(() =>
      parseIllinoisArtsCouncilSource(
        JSON.stringify({ data: source.data.slice(1) }),
        "2026-08-08",
      ),
    ).toThrow(/source-row contract/);

    const malformed = structuredClone(source);
    malformed.data[0][2] = "unknown";
    expect(() =>
      parseIllinoisArtsCouncilSource(JSON.stringify(malformed), "2026-08-08"),
    ).toThrow(/invalid grant amount/);

    const summaryDrift = structuredClone(source);
    const grantTotal = summaryDrift.data.find(
      (row: string[]) => row[0] === "GRANT TOTAL",
    );
    grantTotal[2] = "$1";
    expect(() =>
      parseIllinoisArtsCouncilSource(JSON.stringify(summaryDrift), "2026-08-08"),
    ).toThrow(/grant-total row/);
  });
});
