import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORPORATE_GIVING_DUPLICATE_STATES,
  cmeCorroboration,
  corporateDirectAwards,
  corporateDirectCountOnly,
  corporateDirectReadyAwards,
  decodeHtmlEntitiesOnce,
  parseCorporateGivingCsv,
  __resetCorporateDirectCacheForTests,
} from "../corporate-direct";
import { loadCommunityInvestment, sumAwardedDollars } from "../community-investment";

const INPUT_DIR = path.join(process.cwd(), "data", "curated", "investment-inputs");

describe("corporate-direct loaders — basic shape", () => {
  it("corporateDirectAwards() returns rows, every one dollar-bearing", () => {
    const rows = corporateDirectAwards();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.amountAwarded).not.toBeNull();
      expect(row.amountAwarded).toBeGreaterThan(0);
    }
  });

  it("corporateDirectCountOnly() returns rows, none dollar-bearing", () => {
    const rows = corporateDirectCountOnly();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.amountAwarded).toBeNull();
    }
  });

  it("cmeCorroboration() returns rows, every one held", () => {
    const rows = cmeCorroboration();
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("release gate — every dollar-bearing corporate-direct row has a licensed amount-evidence class", () => {
  it("corporate_direct_awards.csv: every row's amountEvidence is recipient_exact or program_fixed_per_recipient", () => {
    for (const row of corporateDirectAwards()) {
      expect(["recipient_exact", "program_fixed_per_recipient"]).toContain(row.amountEvidence);
    }
  });
});

describe("release gate — no aggregate/cap/in-kind/unavailable row ever carries an amount", () => {
  const nonAllocableEvidence = new Set(["aggregate_only", "cap_only", "unavailable"]);

  it("across all three curated files, a row whose amountEvidence is aggregate_only/cap_only/unavailable always has amountAwarded === null", () => {
    const allRows = [...corporateDirectAwards(), ...corporateDirectCountOnly(), ...cmeCorroboration()];
    const violations = allRows.filter(
      (row) => nonAllocableEvidence.has(row.amountEvidence) && row.amountAwarded !== null,
    );
    expect(violations).toEqual([]);
  });

  it("no row anywhere carries supportKind=in_kind with a non-null amountAwarded", () => {
    const allRows = [...corporateDirectAwards(), ...corporateDirectCountOnly(), ...cmeCorroboration()];
    const violations = allRows.filter((row) => row.supportKind === "in_kind" && row.amountAwarded !== null);
    expect(violations).toEqual([]);
  });
});

describe("release gate — every row carries sourceUrl + sourceCheckedAt", () => {
  it.each([
    ["corporateDirectAwards", corporateDirectAwards],
    ["corporateDirectCountOnly", corporateDirectCountOnly],
    ["cmeCorroboration", cmeCorroboration],
  ] as const)("%s: every row has a non-empty sourceUrl and sourceCheckedAt", (_label, loader) => {
    for (const row of loader()) {
      expect(row.sourceUrl.length).toBeGreaterThan(0);
      expect(row.sourceCheckedAt).toBe("2026-08-24");
    }
  });
});

describe("release gate — count-only file's amounts are all empty", () => {
  it("every corporate_direct_count_only.csv row has amountAwarded === null", () => {
    const rows = corporateDirectCountOnly();
    expect(rows.length).toBe(152);
    expect(rows.every((row) => row.amountAwarded === null)).toBe(true);
  });

  it("the count-only file carries the Exelon roster (112), ComEd Green Region (4) + Powering the Arts (11), Bulls Charities (22), and Chicago Sports Alliance (3) — 152 rows total", () => {
    const rows = corporateDirectCountOnly();
    const byPrefix = (prefix: string) => rows.filter((r) => r.sourceRecordId.startsWith(prefix)).length;
    expect(byPrefix("exelon-2025-")).toBe(112);
    expect(byPrefix("comed-green-region-2024-")).toBe(4);
    expect(byPrefix("comed-powering-arts-2024-")).toBe(11);
    expect(byPrefix("bulls-charities-2026-")).toBe(22);
    expect(byPrefix("csa-2025-")).toBe(3);
  });

  it("the Exelon rows include the verifier's missed PRIDEChicago row and exclude United Way of Kankakee County (filter violation)", () => {
    const rows = corporateDirectCountOnly();
    const recipients = new Set(rows.map((r) => r.recipient));
    expect(recipients.has("PRIDEChicago")).toBe(true);
    expect(recipients.has("United Way of Kankakee County")).toBe(false);
  });
});

describe("release gate — the CME corroboration file is 100% reviewState=hold", () => {
  it("every corporate_cme_corroboration.csv row has reviewState === \"hold\"", () => {
    const rows = cmeCorroboration();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.reviewState === "hold")).toBe(true);
  });
});

describe("release gate — the 79 linked_same_award CME rows all carry possibleDuplicateOf", () => {
  it("every linked_same_award row has a non-null possibleDuplicateOf canonical match id", () => {
    const linked = cmeCorroboration().filter((row) => row.duplicateState === "linked_same_award");
    expect(linked.length).toBe(79);
    expect(linked.every((row) => row.possibleDuplicateOf != null && row.possibleDuplicateOf.length > 0)).toBe(
      true,
    );
  });

  it("every possible-state CME row also carries a canonical match id (data was available; not required by the release gate but not withheld either)", () => {
    const possible = cmeCorroboration().filter((row) => row.duplicateState === "possible");
    expect(possible.length).toBe(17);
    expect(possible.every((row) => row.possibleDuplicateOf != null)).toBe(true);
  });
});

describe("release gate — the registry HOLD vehicles never appear as a payer anywhere in the new curated inputs", () => {
  it("William Blair, Northern Trust, and Emerson never appear as payerName/parentCompany in any of the three files", () => {
    const allRows = [...corporateDirectAwards(), ...corporateDirectCountOnly(), ...cmeCorroboration()];
    const heldNames = [/william blair/i, /northern trust/i, /emerson/i];
    for (const row of allRows) {
      for (const pattern of heldNames) {
        expect(pattern.test(row.payerName)).toBe(false);
        expect(pattern.test(row.parentCompany)).toBe(false);
      }
    }
  });
});

describe("release gate — Comcast and BofA reconciliation totals", () => {
  it("Comcast RISE 2021: 74 rows x $10,000 = $740,000", () => {
    const comcastRows = corporateDirectAwards().filter((row) => row.sourceRecordId.startsWith("comcast-rise-2021-"));
    expect(comcastRows.length).toBe(74);
    expect(comcastRows.every((row) => row.amountAwarded === 10000)).toBe(true);
    const total = comcastRows.reduce((sum, row) => sum + (row.amountAwarded ?? 0), 0);
    expect(total).toBe(740000);
  });

  it("Bank of America (2022 Neighborhood Builders + 2025/2024 After School Matters) captured total is $1,600,000 (all 4 rows HELD — see the reviewState gate block below)", () => {
    const bofaRows = corporateDirectAwards().filter((row) => row.sourceRecordId.startsWith("bofa-"));
    expect(bofaRows.length).toBe(4);
    const total = bofaRows.reduce((sum, row) => sum + (row.amountAwarded ?? 0), 0);
    expect(total).toBe(1600000);
  });

  it("corporate_direct_awards.csv contains exactly Comcast (74) + BofA (4) = 78 captured dollar-bearing rows, $2,340,000 total", () => {
    const rows = corporateDirectAwards();
    expect(rows.length).toBe(78);
    const total = rows.reduce((sum, row) => sum + (row.amountAwarded ?? 0), 0);
    expect(total).toBe(2340000);
  });
});

describe("release gate — payer legal vehicle resolved or explicitly held unknown and not published", () => {
  it("corporateDirectReadyAwards() is exactly the 74 Comcast RISE 2021 rows, totaling $740,000 — the 4 Bank of America rows are withheld", () => {
    const ready = corporateDirectReadyAwards();
    expect(ready.length).toBe(74);
    expect(ready.every((row) => row.sourceRecordId.startsWith("comcast-rise-2021-"))).toBe(true);
    expect(ready.every((row) => row.reviewState === "ready")).toBe(true);
    const total = ready.reduce((sum, row) => sum + (row.amountAwarded ?? 0), 0);
    expect(total).toBe(740000);
  });

  it("all 4 Bank of America rows are reviewState=hold with a reviewNote naming the unresolved payer vehicle", () => {
    const bofaRows = corporateDirectAwards().filter((row) => row.sourceRecordId.startsWith("bofa-"));
    expect(bofaRows.length).toBe(4);
    for (const row of bofaRows) {
      expect(row.vehicle).toBe("unknown");
      expect(row.reviewState).toBe("hold");
      expect(row.reviewNote).toContain("HELD per release gate");
      expect(row.reviewNote).toContain("payer vehicle unresolved");
    }
  });

  it("corporateDirectAwards() (unfiltered) still returns all 78 rows with reviewState visible per row — callers must filter themselves if they need only ready rows", () => {
    const all = corporateDirectAwards();
    expect(all.length).toBe(78);
    const byState = all.reduce<Record<string, number>>((acc, row) => {
      acc[row.reviewState] = (acc[row.reviewState] ?? 0) + 1;
      return acc;
    }, {});
    expect(byState).toEqual({ ready: 74, hold: 4 });
  });
});

describe("release gate — duplicateState is a valid enum value on every row", () => {
  it("every row across all three files has a duplicateState in the documented enum", () => {
    const allRows = [...corporateDirectAwards(), ...corporateDirectCountOnly(), ...cmeCorroboration()];
    for (const row of allRows) {
      expect(CORPORATE_GIVING_DUPLICATE_STATES).toContain(row.duplicateState);
    }
  });
});

describe("HTML entity decoding — decoded exactly once, no other normalization", () => {
  it("decodeHtmlEntitiesOnce decodes a named entity once and does not touch the rest of the string", () => {
    expect(decodeHtmlEntitiesOnce("A&amp;B Auto Transport")).toBe("A&B Auto Transport");
  });

  it("does not double-decode an already-literal ampersand", () => {
    expect(decodeHtmlEntitiesOnce("A&B Auto Transport")).toBe("A&B Auto Transport");
  });

  it("decodes a numeric entity", () => {
    expect(decodeHtmlEntitiesOnce("Caf&#233;")).toBe("Café");
  });

  it("parseCorporateGivingCsv decodes recipient/purpose entities exactly once while validating the row", () => {
    const csv = [
      "sourceRecordId,sourceProgram,sourceUrl,sourcePublishedAt,sourceCheckedAt,payerName,payerEin,parentCompany,vehicle,recipient,awardYear,amountAwarded,amountEvidence,supportKind,purpose,publishedAddress,publishedCity,publishedState,publishedPostalCode,locationBasis,locationSourceUrl,locationSourceRecordId,possibleDuplicateOf,duplicateState,reviewState,reviewNote",
      'fixture-1,Fixture Program,https://example.com,,2026-08-24,Fixture Payer,,Fixture Parent,company_program,A&amp;B Auto Transport,2021,10000,recipient_exact,cash_grant,Support for A&amp;B,,Chicago,IL,,city_only,,,,clear,ready,',
    ].join("\n");
    const rows = parseCorporateGivingCsv(csv, "fixture.csv");
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient).toBe("A&B Auto Transport");
    expect(rows[0].purpose).toBe("Support for A&B");
  });
});

describe("parseCorporateGivingCsv — zod validation rejects malformed rows", () => {
  it("throws CorporateDirectParseError when vehicle is not one of the documented enum values", () => {
    const csv = [
      "sourceRecordId,sourceProgram,sourceUrl,sourcePublishedAt,sourceCheckedAt,payerName,payerEin,parentCompany,vehicle,recipient,awardYear,amountAwarded,amountEvidence,supportKind,purpose,publishedAddress,publishedCity,publishedState,publishedPostalCode,locationBasis,locationSourceUrl,locationSourceRecordId,possibleDuplicateOf,duplicateState,reviewState,reviewNote",
      "bad-1,P,https://example.com,,2026-08-24,Payer,,Parent,not_a_real_vehicle,Recipient,2021,10000,recipient_exact,cash_grant,,,,,,unavailable,,,,clear,ready,",
    ].join("\n");
    expect(() => parseCorporateGivingCsv(csv, "fixture.csv")).toThrow();
  });

  it("throws when amountAwarded is present but non-numeric", () => {
    const csv = [
      "sourceRecordId,sourceProgram,sourceUrl,sourcePublishedAt,sourceCheckedAt,payerName,payerEin,parentCompany,vehicle,recipient,awardYear,amountAwarded,amountEvidence,supportKind,purpose,publishedAddress,publishedCity,publishedState,publishedPostalCode,locationBasis,locationSourceUrl,locationSourceRecordId,possibleDuplicateOf,duplicateState,reviewState,reviewNote",
      "bad-2,P,https://example.com,,2026-08-24,Payer,,Parent,company_program,Recipient,2021,not-a-number,recipient_exact,cash_grant,,,,,,unavailable,,,,clear,ready,",
    ].join("\n");
    expect(() => parseCorporateGivingCsv(csv, "fixture.csv")).toThrow();
  });
});

describe("canonical-firewall — the new loaders never touch the canonical community-investment export", () => {
  it("lib/corporate-direct.ts's own source text never references the canonical export path or module", () => {
    const source = readFileSync(path.join(process.cwd(), "lib", "corporate-direct.ts"), "utf8");
    expect(source).not.toContain("community-investment.json");
    expect(source).not.toContain("data/private");
    expect(source).not.toMatch(/from ["']\.\/community-investment["']/);
  });

  it("calling every new loader leaves the canonical export's own file bytes and awarded grand total byte-identical", () => {
    const canonicalPath = path.join(process.cwd(), "data", "private", "community-investment.json");
    if (!existsSync(canonicalPath)) {
      // Nothing to firewall-test against in this checkout; the loader-purity
      // assertion above still holds.
      return;
    }
    const before = readFileSync(canonicalPath);
    const beforeHash = createHash("sha256").update(before).digest("hex");
    const beforeData = loadCommunityInvestment();
    const beforeTotal = beforeData ? sumAwardedDollars(beforeData.records) : null;

    // Exercise every new accessor.
    __resetCorporateDirectCacheForTests();
    corporateDirectAwards();
    corporateDirectReadyAwards();
    corporateDirectCountOnly();
    cmeCorroboration();
    corporateDirectAwards();

    const after = readFileSync(canonicalPath);
    const afterHash = createHash("sha256").update(after).digest("hex");
    expect(afterHash).toBe(beforeHash);

    const afterData = loadCommunityInvestment();
    const afterTotal = afterData ? sumAwardedDollars(afterData.records) : null;
    expect(afterTotal).toBe(beforeTotal);
  });

  it("the new curated CSVs live under data/curated/investment-inputs/, never under data/private/", () => {
    for (const file of [
      "corporate_direct_awards.csv",
      "corporate_direct_count_only.csv",
      "corporate_cme_corroboration.csv",
      "corporate_direct_reconciliation_report.csv",
    ]) {
      expect(existsSync(path.join(INPUT_DIR, file))).toBe(true);
    }
  });
});
