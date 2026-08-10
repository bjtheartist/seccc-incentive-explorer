import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOfficialAwardDuplicateFacts,
  mapPartnerNofAwards,
  parseDelimited,
  type OfficialAwardDuplicateFact,
} from "../../scripts/export-community-investment";
import {
  dedupeInvestmentRecords,
  type CommunityInvestmentExport,
  type CommunityInvestmentRecord,
} from "../community-investment";

const REPO_ROOT = path.resolve(__dirname, "../..");
const INPUT_DIR = path.join(REPO_ROOT, "data", "curated", "investment-inputs");

function readPartnerRows(): Record<string, string>[] {
  return parseDelimited(
    readFileSync(path.join(INPUT_DIR, "ellen_nof_awardees.tsv"), "utf8"),
    "\t",
  );
}

function readOfficialAwardFacts(): OfficialAwardDuplicateFact[] {
  return [
    ...buildOfficialAwardDuplicateFacts(
      JSON.parse(readFileSync(path.join(INPUT_DIR, "nof_small.json"), "utf8")),
      2017,
    ),
    ...buildOfficialAwardDuplicateFacts(
      JSON.parse(readFileSync(path.join(INPUT_DIR, "nof_large.json"), "utf8")),
      2017,
    ),
    ...buildOfficialAwardDuplicateFacts(
      JSON.parse(readFileSync(path.join(INPUT_DIR, "sbif.json"), "utf8")),
      2020,
    ),
  ];
}

describe("partner NOF input mapping", () => {
  it("uses the official approval year and never a later completion year", () => {
    const officialAwards = buildOfficialAwardDuplicateFacts(
      [
        {
          project_name: "Completion Year Trap",
          incentive_amount: "50000.00",
          approval_date: "2018-08-27T00:00:00.000",
          completion_date: "2020-09-30T00:00:00.000",
        },
      ],
      2017,
    );
    expect(officialAwards).toEqual([
      {
        recipient: "Completion Year Trap",
        amountAwarded: 50000,
        approvalYear: 2018,
      },
    ]);

    const result = mapPartnerNofAwards(
      [
        {
          Project: "Completion Year Trap",
          Address: "1 E Test St",
          "Award Amount": "50000.00",
          "Year Awarded": "2020",
        },
      ],
      new Map(),
      (address) => address,
      officialAwards,
    );
    expect(result.confirmedDuplicateRows).toBe(0);
    expect(result.reconciliation[0]?.outcome).toBe("accepted");
  });

  it("drops only an approval-year-confirmed duplicate and protects every survivor from generic dedupe", () => {
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
        approvalYear: 2017,
      },
      {
        recipient: "Rock the Islands Café",
        amountAwarded: 59475,
        approvalYear: 2020,
      },
    ];
    const query = (address: string) => `${address}, Chicago, IL`;
    const geocodes = new Map([
      [query("100 E Test St"), { lat: 41.8, lng: -87.6 }],
    ]);

    const result = mapPartnerNofAwards(rows, geocodes, query, officialAwards);

    expect(result.confirmedDuplicateRows).toBe(1);
    expect(result.reconciliation).toEqual([
      {
        outcome: "confirmed-duplicate",
        inputIndex: 0,
        recipient: "South Shore Brew",
        amountAwarded: 98420.24,
        awardYear: 2017,
        officialRecipient: "South Shore Brew",
        officialApprovalYear: 2017,
      },
      {
        outcome: "accepted",
        inputIndex: 1,
        recipient: "Rock the Islands Café",
        amountAwarded: 59475,
        awardYear: 2019,
      },
      {
        outcome: "accepted",
        inputIndex: 2,
        recipient: "Mapped Partner Project",
        amountAwarded: 25000,
        awardYear: 2020,
      },
    ]);
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

    const classified = result.records.map((record) => ({
      ...record,
      governmentFundingPurpose: "capital_project" as const,
    }));
    const mappedPartner = classified.find(
      (record) => record.recipient === "Mapped Partner Project",
    );
    expect(mappedPartner).toBeDefined();
    const collidingOfficial: CommunityInvestmentRecord = {
      ...mappedPartner!,
      id: "official-mapped-partner-project",
      recipient: "Mapped Partner Project LLC",
      status: "completed",
      recordDate: "2022-01-01T00:00:00.000",
      recordProvenance: "official",
    };
    const downstream = dedupeInvestmentRecords([...classified, collidingOfficial]);
    expect(downstream.removedCount).toBe(0);
    expect(
      downstream.records.filter((record) => record.recordProvenance === "partner-list"),
    ).toHaveLength(2);
    expect(downstream.records.map((record) => record.id)).toContain(
      mappedPartner!.id,
    );
  });

  it("reconciles all 38 current inputs to 36 accepted and two exact confirmed duplicates", () => {
    const partnerRows = readPartnerRows();
    const result = mapPartnerNofAwards(
      partnerRows,
      new Map(),
      (address) => address,
      readOfficialAwardFacts(),
    );
    const confirmed = result.reconciliation.filter(
      (outcome) => outcome.outcome === "confirmed-duplicate",
    );
    const accepted = result.reconciliation.filter(
      (outcome) => outcome.outcome === "accepted",
    );

    expect(partnerRows).toHaveLength(38);
    expect(result.reconciliation).toHaveLength(partnerRows.length);
    expect(accepted).toHaveLength(36);
    expect(result.records).toHaveLength(accepted.length);
    expect(result.records.map((record) => record.recipient)).toEqual(
      accepted.map((outcome) => outcome.recipient),
    );
    expect(confirmed).toEqual([
      {
        outcome: "confirmed-duplicate",
        inputIndex: 6,
        recipient: "South Shore Brew",
        amountAwarded: 98420.24,
        awardYear: 2017,
        officialRecipient: "South Shore Brew",
        officialApprovalYear: 2017,
      },
      {
        outcome: "confirmed-duplicate",
        inputIndex: 10,
        recipient: "Urban Core",
        amountAwarded: 250000,
        awardYear: 2019,
        officialRecipient: "Urban Core",
        officialApprovalYear: 2019,
      },
    ]);
  });

  it("commits every accepted partner row, keeps official duplicates single-counted, and reconciles totals", () => {
    const partnerRows = readPartnerRows();
    const partnerMapping = mapPartnerNofAwards(
      partnerRows,
      new Map(),
      (address) => address,
      readOfficialAwardFacts(),
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

    const committedPartnerRows = output.records.filter(
      (record) => record.recordProvenance === "partner-list",
    );
    expect(committedPartnerRows.map((record) => record.recipient)).toEqual(
      partnerMapping.reconciliation
        .filter((outcome) => outcome.outcome === "accepted")
        .map((outcome) => outcome.recipient),
    );

    const recomputedAwarded = output.records.reduce(
      (sum, record) => sum + (record.amountAwarded ?? 0),
      0,
    );
    expect(output.meta.totalRecords).toBe(43971);
    expect(output.meta.totalRecords).toBe(output.records.length);
    expect(output.meta.pointCount).toBe(30560);
    expect(output.meta.citywideCount).toBe(7063);
    expect(output.meta.totalDollarsAwarded).toBeCloseTo(3163877829.81, 2);
    expect(output.meta.totalDollarsAwarded).toBeCloseTo(recomputedAwarded, 2);
    expect(output.meta.counts["nof-small"]).toBe(162);
    expect(output.meta.sources).toHaveLength(24);
    expect(output.meta.droppedNoGeocode).toBe(0);
    expect(output.meta.dedupedRows).toBe(7);
    expect(output.meta.sources).toContain(
      "City of Chicago Community Development Grant — award rounds 2022–2026 (curated published award announcements; per-row source links retained)",
    );
    expect(output.meta.sources).toContain(
      "Neighborhood Opportunity Fund corridor award list 2017–2020 — Jim's South Shore partner list (partner-reported; confirmed official duplicates removed)",
    );
    expect(output.meta.sources.join("\n")).not.toContain("2022–2025");
  });
});
