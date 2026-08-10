import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  mapPartnerNofAwards,
  parseDelimited,
  type OfficialAwardDuplicateFact,
} from "../../scripts/export-community-investment";
import type { CommunityInvestmentExport } from "../community-investment";

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_DIR = path.join(REPO_ROOT, "data", "curated", "investment-inputs");

describe("partner NOF input mapping", () => {
  it("drops only an independently confirmed duplicate and holds a unique geocode miss citywide", () => {
    const rows = [
      {
        Project: "South Shore Brew",
        Address: "7101 S. Yates Blvd.",
        "Award Amount": "98420.24",
        "Year Awarded": "2017",
      },
      {
        Project: "Rock the Islands Café",
        Address: "7114 S. Yates Blvd.",
        "Award Amount": "59475.00",
        "Year Awarded": "2019",
      },
      {
        Project: "Mapped Partner Project",
        Address: "100 E Test St",
        "Award Amount": "25000.00",
        "Year Awarded": "2020",
      },
    ];
    const officialAwards: OfficialAwardDuplicateFact[] = [
      {
        recipient: "South Shore Brew",
        amountAwarded: 98420.24,
        awardYears: [2017, 2019],
      },
    ];
    const query = (address: string) => `${address}, Chicago, IL`;
    const geocodes = new Map([
      [query("100 E Test St"), { lat: 41.8, lng: -87.6 }],
    ]);

    const result = mapPartnerNofAwards(rows, geocodes, query, officialAwards);

    expect(result.confirmedDuplicateRows).toBe(1);
    expect(result.records.map((record) => record.recipient)).toEqual([
      "Rock the Islands Café",
      "Mapped Partner Project",
    ]);
    expect(result.records[0]).toMatchObject({
      amountAwarded: 59475,
      address: "7114 S. Yates Blvd.",
      geometry: { kind: "citywide" },
      recordProvenance: "partner-list",
    });
    expect(result.records[1].geometry).toEqual({ kind: "point", lat: 41.8, lng: -87.6 });
    expect(result.addressGeocodeMisses).toBe(1);
    expect(result.heldCitywideDollars).toBe(59475);
  });

  it("commits Rock the Islands once, keeps South Shore Brew single-counted, and reconciles totals", () => {
    const partnerRows = parseDelimited(
      readFileSync(path.join(INPUT_DIR, "ellen_nof_awardees.tsv"), "utf8"),
      "\t",
    );
    const output = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "data", "private", "community-investment.json"), "utf8"),
    ) as CommunityInvestmentExport;

    expect(partnerRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Project: "Rock the Islands Café",
          Address: "7114 S. Yates Blvd.",
          "Award Amount": "59475.00",
        }),
      ]),
    );

    const rock = output.records.filter((record) => record.recipient === "Rock the Islands Café");
    expect(rock).toHaveLength(1);
    expect(rock[0]).toMatchObject({
      amountAwarded: 59475,
      address: "7114 S. Yates Blvd.",
      geometry: { kind: "citywide" },
      recordProvenance: "partner-list",
    });

    const southShoreBrew = output.records.filter(
      (record) => record.recipient === "South Shore Brew",
    );
    expect(southShoreBrew).toHaveLength(1);
    expect(southShoreBrew[0].recordProvenance).toBe("official");

    const recomputedAwarded = output.records.reduce(
      (sum, record) => sum + (record.amountAwarded ?? 0),
      0,
    );
    expect(output.meta.totalRecords).toBe(output.records.length);
    expect(output.meta.totalDollarsAwarded).toBeCloseTo(recomputedAwarded, 2);
    expect(output.meta.droppedNoGeocode).toBe(0);
    expect(output.meta.sources).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Community Development Grant.*2022–2026.*per-row source links retained/i),
        expect.stringMatching(/South Shore partner list.*partner-reported/i),
      ]),
    );
    expect(output.meta.sources.join("\n")).not.toContain("2022–2025");
  });
});
