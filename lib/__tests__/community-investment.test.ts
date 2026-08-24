import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoBannedFigureKeys,
  BANNED_FIGURE_KEY_RE,
  buildCommunityInvestmentExport,
  CAPITAL_CLASSES,
  countBySource,
  dedupeInvestmentRecords,
  filterInvestmentBySources,
  findBannedFigureKeys,
  FUNDER_TYPES,
  INVESTMENT_SOURCES,
  INVESTMENT_STATUSES,
  isRoundCapAmount,
  loadCommunityInvestment,
  normalizeAddressForDedupe,
  normalizeRecipientForDedupe,
  SOURCE_CAPITAL_CLASS,
  SOURCE_FUNDER_TYPE,
  sumAnnouncedInvestment,
  sumAuthorizedByClass,
  sumAwardedDollars,
  sumCreditCapital,
  type CommunityInvestmentExport,
  type CommunityInvestmentRecord,
  type InvestmentGeometry,
} from "../community-investment";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const POINT = (lat: number, lng: number): InvestmentGeometry => ({ kind: "point", lat, lng });

function rec(over: Partial<CommunityInvestmentRecord> & { id: string }): CommunityInvestmentRecord {
  const funderType = over.funderType ?? "government";
  return {
    source: "nof-small",
    funderType,
    governmentFundingPurpose:
      over.governmentFundingPurpose !== undefined
        ? over.governmentFundingPurpose
        : funderType === "government"
          ? "capital_project"
          : null,
    funderName: "Neighborhood Opportunity Fund (City of Chicago)",
    recipient: "Test Grantee",
    amountAwarded: 100000,
    logLine: null,
    year: 2022,
    geometry: POINT(41.7, -87.6),
    address: "1 MAIN ST",
    status: "completed",
    capitalClass: "grant",
    links: [],
    ...over,
  };
}

// ── Enums are complete + internally consistent ───────────────────────────────

describe("source / funderType / status enums", () => {
  it("SOURCE_FUNDER_TYPE covers every source and maps to a valid funderType", () => {
    for (const source of INVESTMENT_SOURCES) {
      const ft = SOURCE_FUNDER_TYPE[source];
      expect(ft, `${source} has a funderType`).toBeDefined();
      expect(FUNDER_TYPES).toContain(ft);
    }
    // No stray keys beyond the declared sources.
    expect(Object.keys(SOURCE_FUNDER_TYPE).sort()).toEqual([...INVESTMENT_SOURCES].sort());
  });

  it("the government/philanthropic/private split matches the spec", () => {
    expect(SOURCE_FUNDER_TYPE["nof-small"]).toBe("government");
    expect(SOURCE_FUNDER_TYPE["nof-large"]).toBe("government");
    expect(SOURCE_FUNDER_TYPE.sbif).toBe("government");
    expect(SOURCE_FUNDER_TYPE.cdg).toBe("government");
    expect(SOURCE_FUNDER_TYPE.foundation).toBe("philanthropic");
    expect(SOURCE_FUNDER_TYPE.development).toBe("private_development");
    expect(SOURCE_FUNDER_TYPE["cook-source-2023"]).toBe("government");
    expect(SOURCE_FUNDER_TYPE["illinois-b2b"]).toBe("government");
    expect(SOURCE_FUNDER_TYPE["sba-rrf"]).toBe("government");
    expect(SOURCE_FUNDER_TYPE["dceo-capital"]).toBe("government");
  });

  it("the enum arrays carry exactly the documented members", () => {
    expect([...INVESTMENT_SOURCES]).toEqual([
      "nof-small",
      "nof-large",
      "sbif",
      "cdg",
      "foundation",
      "development",
      "tif",
      "cdbg-home",
      "lihtc",
      "nmtc",
      "cook-source-2023",
      "illinois-big",
      "illinois-hospitality-emergency",
      "illinois-b2b",
      "sba-rrf",
      "dceo-capital",
    ]);
    expect([...FUNDER_TYPES]).toEqual([
      "government",
      "philanthropic",
      "corporate",
      "private_development",
    ]);
    expect([...INVESTMENT_STATUSES]).toEqual([
      "completed",
      "awarded",
      "disbursed",
      "appropriated",
      "announced",
      "proposed",
      "under_construction",
      "partially_open",
      "opened",
      "stalled",
      "cancelled",
    ]);
  });

  it("the original four capital-spine sources map to government funderType", () => {
    for (const s of ["tif", "cdbg-home", "lihtc", "nmtc"] as const) {
      expect(SOURCE_FUNDER_TYPE[s]).toBe("government");
    }
  });
});

// ── capitalClass axis (grant / tif_subsidy / federal_program / tax_credit) ─────

describe("capitalClass axis", () => {
  it("CAPITAL_CLASSES carries exactly the five documented members", () => {
    expect([...CAPITAL_CLASSES]).toEqual([
      "grant",
      "tif_subsidy",
      "federal_program",
      "tax_credit",
      "state_appropriation",
    ]);
  });

  it("SOURCE_CAPITAL_CLASS covers every source and maps to a valid capitalClass", () => {
    for (const source of INVESTMENT_SOURCES) {
      expect(CAPITAL_CLASSES).toContain(SOURCE_CAPITAL_CLASS[source]);
    }
    expect(Object.keys(SOURCE_CAPITAL_CLASS).sort()).toEqual([...INVESTMENT_SOURCES].sort());
  });

  it("the source → capitalClass split matches the spec", () => {
    expect(SOURCE_CAPITAL_CLASS["nof-small"]).toBe("grant");
    expect(SOURCE_CAPITAL_CLASS.foundation).toBe("grant");
    expect(SOURCE_CAPITAL_CLASS.development).toBe("grant");
    expect(SOURCE_CAPITAL_CLASS.tif).toBe("tif_subsidy");
    expect(SOURCE_CAPITAL_CLASS["cdbg-home"]).toBe("federal_program");
    expect(SOURCE_CAPITAL_CLASS.lihtc).toBe("tax_credit");
    expect(SOURCE_CAPITAL_CLASS.nmtc).toBe("tax_credit");
    expect(SOURCE_CAPITAL_CLASS["cook-source-2023"]).toBe("grant");
    expect(SOURCE_CAPITAL_CLASS["dceo-capital"]).toBe("state_appropriation");
  });
});

// ── Per-field capital totals: each computed from ONE field, never combined ─────

describe("per-field capital totals (authorized / credit / awarded firewall)", () => {
  const tif = (over: Partial<CommunityInvestmentRecord> & { id: string }) =>
    rec({ source: "tif", funderType: "government", capitalClass: "tif_subsidy", amountAwarded: null, authorizedAmount: 5_000_000, status: "awarded", ...over });
  const hud = (over: Partial<CommunityInvestmentRecord> & { id: string }) =>
    rec({ source: "cdbg-home", funderType: "government", capitalClass: "federal_program", amountAwarded: null, authorizedAmount: 200_000, status: "completed", ...over });
  const credit = (over: Partial<CommunityInvestmentRecord> & { id: string }) =>
    rec({ source: "lihtc", funderType: "government", capitalClass: "tax_credit", amountAwarded: null, creditAmount: 9_000_000, status: "awarded", ...over });
  const appropriation = (over: Partial<CommunityInvestmentRecord> & { id: string }) =>
    rec({
      source: "dceo-capital",
      funderType: "government",
      capitalClass: "state_appropriation",
      amountAwarded: null,
      publishedBalance: 750_000,
      status: "appropriated",
      ...over,
    });

  const MIX: CommunityInvestmentRecord[] = [
    rec({ id: "g1", amountAwarded: 250_000 }), // grant
    tif({ id: "t1", authorizedAmount: 5_000_000 }),
    tif({ id: "t2", authorizedAmount: 3_000_000 }),
    hud({ id: "h1", authorizedAmount: 200_000 }),
    credit({ id: "c1", creditAmount: 9_000_000 }),
    credit({ id: "c2", source: "nmtc", creditAmount: 1_000_000, geometry: { kind: "citywide" } }),
    appropriation({ id: "s1" }),
  ];

  it("sumAuthorizedByClass sums ONLY the requested class's authorizedAmount", () => {
    expect(sumAuthorizedByClass(MIX, "tif_subsidy")).toBe(8_000_000);
    expect(sumAuthorizedByClass(MIX, "federal_program")).toBe(200_000);
  });

  it("sumCreditCapital sums every creditAmount (LIHTC + NMTC), never awarded/authorized", () => {
    expect(sumCreditCapital(MIX)).toBe(10_000_000);
  });

  it("the awarded total is UNCHANGED by any authorized/credit dollars", () => {
    // Only the $250k grant is awarded — the $8.2M authorized and $10M credit never enter it.
    expect(sumAwardedDollars(MIX)).toBe(250_000);
    expect(sumAnnouncedInvestment(MIX)).toBe(0);
  });

  it("buildCommunityInvestmentExport reports each total from its own field", () => {
    const out = buildCommunityInvestmentExport(MIX, "2026-07-28T00:00:00.000Z", {
      droppedNoGeocode: 0,
      dedupedRows: 0,
      sources: [],
    });
    expect(out.meta.totalDollarsAwarded).toBe(250_000);
    expect(out.meta.totalAuthorizedTif).toBe(8_000_000);
    expect(out.meta.totalFederalProgram).toBe(200_000);
    expect(out.meta.totalCreditCapital).toBe(10_000_000);
    // The four headline totals are provably disjoint, and DCEO's source-published
    // balance is deliberately not promoted into a fifth headline total.
    expect("totalStateAppropriation" in out.meta).toBe(false);
    expect(findBannedFigureKeys(out)).toEqual([]);
  });

  it("keeps closed recovery amounts out of ordinary awarded totals and normalizes lineage", () => {
    const historical = rec({
      id: "sba-rrf-test",
      source: "sba-rrf",
      funderName: "SBA Restaurant Revitalization Fund",
      recipient: "Historic Restaurant",
      amountAwarded: null,
      status: "disbursed",
      recovery: {
        sourceId: "sba-rrf",
        historicalAmount: {
          value: 125_000,
          currency: "USD",
          assistanceType: "grant",
        },
      },
    });
    const out = buildCommunityInvestmentExport(
      [historical],
      "2026-07-28T00:00:00.000Z",
      { droppedNoGeocode: 0, dedupedRows: 0, sources: [] },
    );
    expect(out.meta.totalDollarsAwarded).toBe(0);
    expect(out.records[0].recovery?.historicalAmount?.value).toBe(125_000);
    expect(out.recoverySources["sba-rrf"]?.lineage[0].role).toBe("root_law");
  });

  it("rejects a recovery record that also populates amountAwarded", () => {
    const dirty = rec({
      id: "sba-rrf-dirty",
      source: "sba-rrf",
      funderName: "SBA Restaurant Revitalization Fund",
      amountAwarded: 125_000,
      status: "disbursed",
      recovery: {
        sourceId: "sba-rrf",
        historicalAmount: {
          value: 125_000,
          currency: "USD",
          assistanceType: "grant",
        },
      },
    });
    expect(() =>
      buildCommunityInvestmentExport(
        [dirty],
        "2026-07-28T00:00:00.000Z",
        { droppedNoGeocode: 0, dedupedRows: 0, sources: [] },
      ),
    ).toThrow("must live only in recovery.historicalAmount");
  });

  it("hard-fails if a tif_subsidy record smuggles an awarded amount", () => {
    const dirty = tif({ id: "bad", amountAwarded: 5_000_000, authorizedAmount: 5_000_000 });
    expect(() =>
      buildCommunityInvestmentExport([dirty], "2026-07-28T00:00:00.000Z", { droppedNoGeocode: 0, dedupedRows: 0, sources: [] }),
    ).toThrow(/tif_subsidy/);
  });

  it("hard-fails if a grant record smuggles a credit amount", () => {
    const dirty = rec({ id: "bad2", capitalClass: "grant", creditAmount: 1_000_000 });
    expect(() =>
      buildCommunityInvestmentExport([dirty], "2026-07-28T00:00:00.000Z", { droppedNoGeocode: 0, dedupedRows: 0, sources: [] }),
    ).toThrow(/grant/);
  });

  it("hard-fails if a state appropriation smuggles an awarded amount", () => {
    const dirty = appropriation({ id: "bad3", amountAwarded: 750_000 });
    expect(() =>
      buildCommunityInvestmentExport([dirty], "2026-07-28T00:00:00.000Z", {
        droppedNoGeocode: 0,
        dedupedRows: 0,
        sources: [],
      }),
    ).toThrow(/state_appropriation/);
  });

  it("hard-fails when a government record has no persisted funding purpose", () => {
    const dirty = rec({ id: "purpose-missing", governmentFundingPurpose: null });
    expect(() =>
      buildCommunityInvestmentExport([dirty], "2026-07-28T00:00:00.000Z", {
        droppedNoGeocode: 0,
        dedupedRows: 0,
        sources: [],
      }),
    ).toThrow(/must carry one source-backed governmentFundingPurpose/);
  });

  it("hard-fails when a non-government record carries a government purpose", () => {
    const dirty = rec({
      id: "purpose-wrong-funder",
      source: "foundation",
      funderType: "philanthropic",
      governmentFundingPurpose: "capital_project",
    });
    expect(() =>
      buildCommunityInvestmentExport([dirty], "2026-07-28T00:00:00.000Z", {
        droppedNoGeocode: 0,
        dedupedRows: 0,
        sources: [],
      }),
    ).toThrow(/must carry governmentFundingPurpose null/);
  });
});

// ── IRON RULE: banned derived-figure key rail ────────────────────────────────

describe("banned-figure key rail", () => {
  it("matches received / available / remaining / unspent case-insensitively", () => {
    expect(BANNED_FIGURE_KEY_RE.test("amountReceived")).toBe(true);
    expect(BANNED_FIGURE_KEY_RE.test("Available")).toBe(true);
    expect(BANNED_FIGURE_KEY_RE.test("remainingBalance")).toBe(true);
    expect(BANNED_FIGURE_KEY_RE.test("unspentFunds")).toBe(true);
    // The legitimate keys we DO ship must not trip the rail.
    expect(BANNED_FIGURE_KEY_RE.test("amountAwarded")).toBe(false);
    expect(BANNED_FIGURE_KEY_RE.test("totalDollarsAwarded")).toBe(false);
    expect(BANNED_FIGURE_KEY_RE.test("publishedBalance")).toBe(false);
  });

  it("findBannedFigureKeys walks nested objects/arrays ([] when clean)", () => {
    expect(findBannedFigureKeys({ records: [{ amountAwarded: 5, meta: { totalDollarsAwarded: 5 } }] })).toEqual([]);
    expect(findBannedFigureKeys({ records: [{ amountReceived: 5 }] })).toEqual(["amountReceived"]);
    expect(findBannedFigureKeys({ a: { b: { remainingToDraw: 1, unspent: 2 } } }).sort()).toEqual([
      "remainingToDraw",
      "unspent",
    ]);
  });

  it("assertNoBannedFigureKeys throws with the offending key, passes when clean", () => {
    expect(() => assertNoBannedFigureKeys({ ok: 1, records: [] })).not.toThrow();
    expect(() => assertNoBannedFigureKeys({ availableFunds: 1 })).toThrow(/availableFunds/);
  });

  it("buildCommunityInvestmentExport hard-fails if a record smuggles in a banned key", () => {
    const dirty = { ...rec({ id: "x" }), amountRemaining: 5 } as unknown as CommunityInvestmentRecord;
    expect(() =>
      buildCommunityInvestmentExport([dirty], "2026-07-27T00:00:00.000Z", {
        droppedNoGeocode: 0,
        dedupedRows: 0,
        sources: [],
      }),
    ).toThrow(/amountRemaining/);
  });
});

// ── Normalization helpers ────────────────────────────────────────────────────

describe("normalizeAddressForDedupe / normalizeRecipientForDedupe", () => {
  it("folds punctuation + whitespace so period-variant addresses match", () => {
    expect(normalizeAddressForDedupe("212 E. 79th St.")).toBe("212 E 79TH ST");
    expect(normalizeAddressForDedupe("212 E 79th St")).toBe("212 E 79TH ST");
    expect(normalizeAddressForDedupe(null)).toBe("");
    expect(normalizeAddressForDedupe("   ")).toBe("");
  });

  it("canonicalizes the trailing street-type so Av / Ave. / Avenue fold together", () => {
    expect(normalizeAddressForDedupe("8126 S Stony Island Av")).toBe("8126 S STONY ISLAND AVE");
    expect(normalizeAddressForDedupe("8126 S. Stony Island Ave.")).toBe("8126 S STONY ISLAND AVE");
    expect(normalizeAddressForDedupe("8126 S Stony Island Avenue")).toBe("8126 S STONY ISLAND AVE");
    // A different street type does NOT fold into another.
    expect(normalizeAddressForDedupe("123 Main St")).toBe("123 MAIN ST");
    expect(normalizeAddressForDedupe("123 Main Street")).toBe("123 MAIN ST");
    expect(normalizeAddressForDedupe("123 Main St")).not.toBe(normalizeAddressForDedupe("123 Main Ave"));
  });

  it("strips legal suffixes so entity-name variants match", () => {
    expect(normalizeRecipientForDedupe("Marina Cartage, Inc.")).toBe("MARINA CARTAGE");
    expect(normalizeRecipientForDedupe("Marina Cartage Inc")).toBe("MARINA CARTAGE");
    expect(normalizeRecipientForDedupe("The Park Manor 75, LLC")).toBe("THE PARK MANOR 75");
    expect(normalizeRecipientForDedupe("David & Jonathan Consulting LLC")).toBe("DAVID JONATHAN CONSULTING");
    expect(normalizeRecipientForDedupe(null)).toBe("");
  });
});

// ── Dedupe behavior ──────────────────────────────────────────────────────────

describe("dedupeInvestmentRecords", () => {
  it("collapses an award shadowed by a completion, keeping the completed record", () => {
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "c", source: "nof-small", status: "completed", recipient: "Urban Core", address: "1840 E 71st St", amountAwarded: 250000 }),
      rec({ id: "a", source: "nof-small", status: "awarded", recipient: "Urban Core", address: "1840 E. 71st St.", amountAwarded: 250000 }),
    ]);
    expect(removedCount).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("c");
    expect(records[0].status).toBe("completed");
  });

  it("keeps the completion even when the awarded row is seen FIRST", () => {
    const { records } = dedupeInvestmentRecords([
      rec({ id: "a", source: "cdg", status: "awarded", recipient: "Rise Training Academy", address: "8300 S Halsted St", amountAwarded: 250000 }),
      rec({ id: "c", source: "nof-small", status: "completed", recipient: "Rise Training Academy", address: "8300 S Halsted St", amountAwarded: 250000 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("completed");
  });

  it("KEEPS distinct businesses that share a multi-tenant address + standardized amount", () => {
    // The 6212 N Lincoln Ave case: four different SBIF grantees, each $62,500.
    const four = ["David & Jonathan Consulting LLC", "PreroLaw P.C", "Rena Meystel Photography LLC", "Handoff Returns, Inc."].map(
      (name, i) => rec({ id: `l${i}`, source: "sbif", status: "completed", recipient: name, address: "6212 N Lincoln Ave", amountAwarded: 62500 }),
    );
    const { records, removedCount } = dedupeInvestmentRecords(four);
    expect(removedCount).toBe(0);
    expect(records).toHaveLength(4);
  });

  it("collapses a true duplicate row (same name, same status, same address+amount)", () => {
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "m1", source: "sbif", status: "completed", recipient: "Marina Cartage, Inc.", address: "4450 S Morgan St", amountAwarded: 110802 }),
      rec({ id: "m2", source: "sbif", status: "completed", recipient: "Marina Cartage Inc", address: "4450 S Morgan St", amountAwarded: 110802 }),
    ]);
    expect(removedCount).toBe(1);
    expect(records).toHaveLength(1);
  });

  it("KEEPS two same-name completions at the same address+amount on DIFFERENT dates", () => {
    // House 2 Home LLC: two real $75,000 SBIF completion cycles at 655 W 59th St,
    // 9 months apart — two events, not a duplicated row. Both must survive.
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "h1", source: "sbif", status: "completed", recipient: "House 2 Home LLC", address: "655 W 59th St", amountAwarded: 75000, recordDate: "2023-02-24T00:00:00.000" }),
      rec({ id: "h2", source: "sbif", status: "completed", recipient: "House 2 Home LLC", address: "655 W 59th St", amountAwarded: 75000, recordDate: "2023-11-14T00:00:00.000" }),
    ]);
    expect(removedCount).toBe(0);
    expect(records.map((r) => r.id)).toEqual(["h1", "h2"]);
  });

  it("KEEPS a surviving partner-list row even when address, amount, and an alias-like name match an official row", () => {
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "jim-huddle", source: "nof-small", status: "awarded", recipient: "Huddle House Diner", address: "9401 S. Stony Island Ave.", amountAwarded: 1100000, recordProvenance: "partner-list" }),
      rec({ id: "official-huddle", source: "nof-large", status: "awarded", recipient: "Huddle House", address: "9401 S Stony Island Av", amountAwarded: 1100000, recordDate: "2021-06-01T00:00:00.000", recordProvenance: "official" }),
    ]);
    expect(removedCount).toBe(0);
    expect(records.map((r) => r.id)).toEqual(["jim-huddle", "official-huddle"]);
  });

  it("KEEPS a surviving partner-list row when an alias-like official row is nearby", () => {
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "official-huddle", source: "nof-large", status: "awarded", recipient: "Huddle House", address: "9421 S Stony Island Ave", amountAwarded: 1100000, recordDate: "2021-05-28T00:00:00.000", recordProvenance: "official", geometry: { kind: "point", lat: 41.723734068, lng: -87.584991129 } }),
      rec({ id: "jim-huddle", source: "nof-small", status: "awarded", recipient: "Huddle House Diner", address: "9401 S. Stony Island Ave.", amountAwarded: 1100000, recordProvenance: "partner-list", geometry: { kind: "point", lat: 41.723312670502, lng: -87.585069012587 } }),
    ]);
    expect(removedCount).toBe(0);
    expect(records.map((r) => r.id)).toEqual(["official-huddle", "jim-huddle"]);
  });

  it("KEEPS a partner-list row when the nearby official row's name is unrelated (proximity alone is not enough)", () => {
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "official-x", source: "nof-small", status: "completed", recipient: "Bronze Gallery Inc", address: "9421 S Stony Island Ave", amountAwarded: 250000, recordDate: "2022-01-01T00:00:00.000", recordProvenance: "official", geometry: { kind: "point", lat: 41.723734068, lng: -87.584991129 } }),
      rec({ id: "jim-y", source: "nof-small", status: "awarded", recipient: "Strawberry Cafe", address: "9401 S. Stony Island Ave.", amountAwarded: 250000, recordProvenance: "partner-list", geometry: { kind: "point", lat: 41.723312670502, lng: -87.585069012587 } }),
    ]);
    expect(removedCount).toBe(0);
    expect(records.map((r) => r.id).sort()).toEqual(["jim-y", "official-x"]);
  });

  it("KEEPS a cross-provenance pair of UNRELATED businesses at a shared round cap", () => {
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "jim-a", source: "nof-small", status: "awarded", recipient: "Strawberry Cafe", address: "1652 E 79th St", amountAwarded: 250000, recordProvenance: "partner-list" }),
      rec({ id: "official-b", source: "nof-small", status: "completed", recipient: "Bronze Gallery Inc", address: "1652 E 79th St", amountAwarded: 250000, recordDate: "2022-03-01T00:00:00.000", recordProvenance: "official" }),
    ]);
    expect(removedCount).toBe(0);
    expect(records.map((r) => r.id).sort()).toEqual(["jim-a", "official-b"]);
  });

  it("collapses an identical-date same-name completion pair (a genuine Socrata duplicate)", () => {
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "d1", source: "sbif", status: "completed", recipient: "Marina Cartage, Inc.", address: "4450 S Morgan St", amountAwarded: 110802, recordDate: "2020-12-17T00:00:00.000" }),
      rec({ id: "d2", source: "sbif", status: "completed", recipient: "Marina Cartage Inc", address: "4450 S Morgan St", amountAwarded: 110802, recordDate: "2020-12-17T00:00:00.000" }),
    ]);
    expect(removedCount).toBe(1);
    expect(records).toHaveLength(1);
  });

  it("KEEPS two DIFFERENT businesses that share an address and a round program cap ($250,000)", () => {
    // Acme (NOF completion) and Zenith (CDG award) at one multi-tenant address,
    // both at the $250k cap — a coincidental collision, NOT the same project.
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "acme", source: "nof-small", status: "completed", recipient: "Acme Bakery LLC", address: "5500 S King Dr", amountAwarded: 250000, recordDate: "2022-05-01T00:00:00.000" }),
      rec({ id: "zenith", source: "cdg", status: "awarded", recipient: "Zenith Auto Repair Inc", address: "5500 S King Dr", amountAwarded: 250000 }),
    ]);
    expect(removedCount).toBe(0);
    expect(records.map((r) => r.id).sort()).toEqual(["acme", "zenith"]);
  });

  it("COLLAPSES a DBA award/completion pair with divergent names at a non-round amount", () => {
    // "Legacy, etc" (NOF completion) vs "Mikkey's Retro Grill" (Jim's corridor
    // award) at 8126 S Stony Island Ave, both $139,058.77 — one rebranded project.
    // The distinctive non-round amount is enough to collapse despite the names
    // and the "Av"/"Ave." spelling difference.
    const { records, removedCount } = dedupeInvestmentRecords([
      rec({ id: "legacy", source: "nof-small", status: "completed", recipient: "Legacy, etc", address: "8126 S Stony Island Av", amountAwarded: 139058.77, recordDate: "2018-06-30T00:00:00.000" }),
      rec({ id: "mikkey", source: "nof-small", status: "awarded", recipient: "Mikkey's Retro Grill", address: "8126 S. Stony Island Ave.", amountAwarded: 139058.77 }),
    ]);
    expect(removedCount).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("legacy"); // completion holds the slot
    expect(records[0].status).toBe("completed");
  });

  it("isRoundCapAmount flags whole $25k multiples only", () => {
    expect(isRoundCapAmount(250000)).toBe(true);
    expect(isRoundCapAmount(25000)).toBe(true);
    expect(isRoundCapAmount(139058.77)).toBe(false);
    expect(isRoundCapAmount(62500)).toBe(false);
    expect(isRoundCapAmount(0)).toBe(false);
    expect(isRoundCapAmount(null)).toBe(false);
  });

  it("NEVER dedupes philanthropic (foundation) rows, even at a shared intermediary address", () => {
    const a = rec({ id: "f1", source: "foundation", funderType: "philanthropic", funderName: "Foundation A", recipient: "Chicago Community Foundation", address: "33 S State St", amountAwarded: 5000, status: "awarded" });
    const b = rec({ id: "f2", source: "foundation", funderType: "philanthropic", funderName: "Foundation B", recipient: "Chicago Community Foundation", address: "33 S State St", amountAwarded: 5000, status: "awarded" });
    const { records, removedCount } = dedupeInvestmentRecords([a, b]);
    expect(removedCount).toBe(0);
    expect(records).toHaveLength(2);
  });

  it("passes ineligible rows through untouched (citywide geometry, null amount, blank address)", () => {
    const citywide = rec({ id: "cw", source: "foundation", funderType: "philanthropic", geometry: { kind: "citywide" }, address: null });
    const noAmount = rec({ id: "na", source: "cdg", amountAwarded: null, recipient: "Pre-dev grant", address: "1 A ST" });
    const noAddr = rec({ id: "nd", source: "cdg", address: null });
    const { records, removedCount } = dedupeInvestmentRecords([citywide, noAmount, noAddr]);
    expect(removedCount).toBe(0);
    expect(records.map((r) => r.id)).toEqual(["cw", "na", "nd"]);
  });
});

// ── Aggregation + export assembly ────────────────────────────────────────────

describe("countBySource / sumAwardedDollars / buildCommunityInvestmentExport", () => {
  it("counts every source and sums only non-null amounts", () => {
    const records = [
      rec({ id: "1", source: "cdg", amountAwarded: 100 }),
      rec({ id: "2", source: "cdg", amountAwarded: null }),
      rec({ id: "3", source: "foundation", funderType: "philanthropic", amountAwarded: 50 }),
    ];
    const counts = countBySource(records);
    expect(counts.cdg).toBe(2);
    expect(counts.foundation).toBe(1);
    expect(counts["nof-small"]).toBe(0);
    expect(sumAwardedDollars(records)).toBe(150);
  });

  it("assembles the export shape with point/citywide split and provenance", () => {
    const records = [
      rec({ id: "p", geometry: POINT(41.7, -87.6) }),
      rec({ id: "c", source: "foundation", funderType: "philanthropic", geometry: { kind: "citywide" }, amountAwarded: 25 }),
    ];
    const out = buildCommunityInvestmentExport(records, "2026-07-27T00:00:00.000Z", {
      droppedNoGeocode: 3,
      dedupedRows: 2,
      sources: ["src label"],
    });
    expect(out.generatedAt).toBe("2026-07-27T00:00:00.000Z");
    expect(out.meta.totalRecords).toBe(2);
    expect(out.meta.pointCount).toBe(1);
    expect(out.meta.citywideCount).toBe(1);
    expect(out.meta.totalDollarsAwarded).toBe(100025);
    expect(out.meta.droppedNoGeocode).toBe(3);
    expect(out.meta.dedupedRows).toBe(2);
    expect(out.meta.sources).toEqual(["src label"]);
    expect(findBannedFigureKeys(out)).toEqual([]);
  });
});

// ── Announced private capital is a SEPARATE truth from awarded dollars ─────────

describe("announcedInvestment vs amountAwarded separation", () => {
  const dev = (over: Partial<CommunityInvestmentRecord> & { id: string }) =>
    rec({
      source: "development",
      funderType: "private_development",
      amountAwarded: null, // developments are NEVER awarded
      status: "under_construction",
      ...over,
    });

  it("sumAnnouncedInvestment totals only announcedInvestment (never amountAwarded)", () => {
    const records = [
      rec({ id: "g", amountAwarded: 250_000 }), // government award, no announced figure
      dev({ id: "d1", announcedInvestment: 7_000_000_000 }),
      dev({ id: "d2", announcedInvestment: 9_000_000_000 }),
      dev({ id: "d3", announcedInvestment: null }), // subset/blank → not counted
    ];
    expect(sumAnnouncedInvestment(records)).toBe(16_000_000_000);
    // The awarded sum ignores announcedInvestment entirely.
    expect(sumAwardedDollars(records)).toBe(250_000);
  });

  it("meta.totalDollarsAwarded EXCLUDES announcedInvestment; announcedCapitalTotal sums it", () => {
    const records = [
      rec({ id: "g", amountAwarded: 250_000 }),
      dev({ id: "d1", announcedInvestment: 7_000_000_000 }),
      dev({ id: "d2", announcedInvestment: 500_000_000 }),
    ];
    const out = buildCommunityInvestmentExport(records, "2026-07-27T00:00:00.000Z", {
      droppedNoGeocode: 0,
      dedupedRows: 0,
      sources: [],
      subsetExcluded: 1,
      privateLedExcluded: 0,
    });
    // The awarded total is the government award ALONE — the $7.5B announced is not in it.
    expect(out.meta.totalDollarsAwarded).toBe(250_000);
    expect(out.meta.announcedCapitalTotal).toBe(7_500_000_000);
    expect(out.meta.subsetExcluded).toBe(1);
    expect(out.meta.privateLedExcluded).toBe(0);
  });

  it("recomputes totalDollarsAwarded from records and matches an amountAwarded-only sum", () => {
    const records = [
      rec({ id: "a", amountAwarded: 100_000 }),
      rec({ id: "b", source: "foundation", funderType: "philanthropic", amountAwarded: 50_000 }),
      dev({ id: "c", announcedInvestment: 1_000_000_000 }),
    ];
    const out = buildCommunityInvestmentExport(records, "2026-07-27T00:00:00.000Z", {
      droppedNoGeocode: 0,
      dedupedRows: 0,
      sources: [],
    });
    const awardedOnly = records.reduce((s, r) => s + (r.amountAwarded ?? 0), 0);
    expect(out.meta.totalDollarsAwarded).toBe(awardedOnly);
    expect(out.meta.totalDollarsAwarded).toBe(150_000);
  });

  it("NEVER dedupes a private_development row, even at a shared address+amount", () => {
    // Two developments sharing an address; developments are excluded from dedupe
    // (funderType private_development is ineligible), so both survive regardless
    // of their new lifecycle statuses.
    const { records, removedCount } = dedupeInvestmentRecords([
      dev({ id: "d1", recipient: "Megasite A", address: "100 Main St", announcedInvestment: 1_000_000, status: "under_construction" }),
      dev({ id: "d2", recipient: "Megasite B", address: "100 Main St", announcedInvestment: 1_000_000, status: "opened" }),
    ]);
    expect(removedCount).toBe(0);
    expect(records.map((r) => r.id)).toEqual(["d1", "d2"]);
  });
});

// ── Grep rail: no code ever adds announcedInvestment + amountAwarded together ──

describe("source rail: announcedInvestment is never summed with amountAwarded", () => {
  it("no source line combines the two fields with arithmetic", () => {
    const roots = ["lib", "components", "scripts", "app"];
    const files: string[] = [];
    const walk = (dir: string) => {
      const abs = path.join(process.cwd(), dir);
      if (!existsSync(abs)) return;
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__") continue;
          walk(rel);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          files.push(path.join(process.cwd(), rel));
        }
      }
    };
    for (const r of roots) walk(r);

    // Flag any single expression that puts both identifiers on the same side of
    // a '+' (either order) — the exact "combine the two truths" mistake the rail
    // exists to prevent.
    const offend =
      /announcedInvestment[^\n;]*\+[^\n;]*amountAwarded|amountAwarded[^\n;]*\+[^\n;]*announcedInvestment/;
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const line of text.split("\n")) {
        if (offend.test(line)) hits.push(`${path.relative(process.cwd(), f)}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("filterInvestmentBySources", () => {
  const data: CommunityInvestmentExport = buildCommunityInvestmentExport(
    [rec({ id: "1", source: "cdg" }), rec({ id: "2", source: "foundation", funderType: "philanthropic" })],
    "2026-07-27T00:00:00.000Z",
    { droppedNoGeocode: 0, dedupedRows: 0, sources: [] },
  );

  it("returns the export unfiltered for null/empty sources", () => {
    expect(filterInvestmentBySources(data, null).records).toHaveLength(2);
    expect(filterInvestmentBySources(data, []).records).toHaveLength(2);
  });

  it("filters records down to the requested sources, meta unchanged", () => {
    const filtered = filterInvestmentBySources(data, ["cdg"]);
    expect(filtered.records.map((r) => r.source)).toEqual(["cdg"]);
    expect(filtered.meta).toEqual(data.meta);
  });
});

// ── File-location guard: the export must NEVER live under public/ ─────────────

describe("private-data location guard", () => {
  const PRIVATE_PATH = path.join(process.cwd(), "data/private/community-investment.json");
  const PUBLIC_DIR = path.join(process.cwd(), "public");

  /** Recursively list every file basename under a directory (empty if absent). */
  function walkFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkFiles(full));
      else out.push(entry.name);
    }
    return out;
  }

  it("no community-investment.json is served from anywhere under public/", () => {
    expect(walkFiles(PUBLIC_DIR)).not.toContain("community-investment.json");
  });

  it("the committed export lives under data/private/", () => {
    // (Skips gracefully before the export has been generated.)
    if (existsSync(PRIVATE_PATH)) {
      expect(PRIVATE_PATH.includes(`${path.sep}data${path.sep}private${path.sep}`)).toBe(true);
    } else {
      expect(existsSync(PRIVATE_PATH)).toBe(false);
    }
  });
});

// ── Committed-file smoke test (hard-runs once the export is committed) ────────

const EXPORT_PATH = path.join(process.cwd(), "data/private/community-investment.json");
const EXPORT_EXISTS = existsSync(EXPORT_PATH);

/**
 * Explicit timeout for the invariant tests that walk EVERY record in the
 * committed export (24k+ records × several `expect()` calls each, out of a
 * ~17 MB JSON). Vitest's 5000 ms default was measured crossing under full-suite
 * worker contention — the suite went red on a timeout unrelated to the change
 * under test, then green on re-run, which trains a team to re-run rather than
 * read the failure.
 *
 * Deliberately per-test rather than a global `testTimeout` in vitest.config.ts:
 * a global bump would also hide a real hang in the ~1,500 fast tests that should
 * still fail loudly at the default. Only the tests that genuinely scale with the
 * export's size opt in.
 */
const COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS = 30_000;

/**
 * Count the DATA rows of a curated input file, so an export invariant can be
 * reconciled against the file that produced it instead of against a number
 * frozen on the day someone ran the export.
 *
 * Deliberately a line count rather than a full CSV parse: these files are
 * generated by scripts/refresh/refresh-live-sources.ts, which quotes fields but
 * collapses every embedded newline, so one physical line is one record. A file
 * that ever breaks that assumption should fail this reconciliation loudly.
 */
function countCuratedCsvRows(file: string): number {
  const text = readFileSync(
    path.join(process.cwd(), "data/curated/investment-inputs", file),
    "utf8",
  );
  return text.split("\n").filter((line) => line.trim() !== "").length - 1; // minus header
}

/**
 * Monotonic floors for the sources re-pulled by the monthly refresh
 * (scripts/refresh/refresh-live-sources.ts). Baselined 2026-07-30, immediately
 * after the first live refresh.
 *
 * A floor is NOT a pin: an upstream that grows passes, and so does a small
 * downward correction. What fails is a source LOSING MORE THAN 2% of itself,
 * which is the shape of a dataset regression (a republication that drops a
 * cohort, a filter that silently narrows, a truncated fetch) rather than of
 * ordinary monthly churn.
 *
 * When a shrink is real and reviewed, RE-BASELINE these numbers in the same PR
 * that accepts the data — that is the human review the refresh workflow exists
 * to force. The July 2026 HUD baseline is itself a re-baseline: HUD removed 431
 * CDBG activity ids (6,503 → 6,082 mapped records) in a republication.
 */
const REFRESHED_SOURCE_FLOORS: ReadonlyArray<{
  source: (typeof INVESTMENT_SOURCES)[number];
  floorAsOf202607: number;
}> = [
  { source: "nof-small", floorAsOf202607: 156 },
  { source: "nof-large", floorAsOf202607: 6 },
  { source: "sbif", floorAsOf202607: 646 },
  { source: "tif", floorAsOf202607: 760 },
  { source: "cdbg-home", floorAsOf202607: 6_082 },
];

describe.skipIf(!EXPORT_EXISTS)("committed community-investment.json", () => {
  it("loadCommunityInvestment returns the documented top-level shape", () => {
    const data = loadCommunityInvestment();
    expect(data).not.toBeNull();
    expect(typeof data!.generatedAt).toBe("string");
    expect(Array.isArray(data!.records)).toBe(true);
    expect(data!.records.length).toBeGreaterThan(0);
    expect(data!.meta.totalRecords).toBe(data!.records.length);
    // point + ZIP-area + citywide partition the records exactly.
    expect(data!.meta.pointCount + (data!.meta.zipAreaCount ?? 0) + data!.meta.citywideCount).toBe(
      data!.records.length,
    );
  });

  it("every record uses only valid enum members and a coherent geometry", () => {
    const data = loadCommunityInvestment()!;
    for (const r of data.records) {
      expect(INVESTMENT_SOURCES).toContain(r.source);
      expect(FUNDER_TYPES).toContain(r.funderType);
      expect(INVESTMENT_STATUSES).toContain(r.status);
      expect(SOURCE_FUNDER_TYPE[r.source]).toBe(r.funderType);
      expect(r.amountAwarded === null || typeof r.amountAwarded === "number").toBe(true);
      if (r.geometry.kind === "point") {
        expect(typeof r.geometry.lat).toBe("number");
        expect(typeof r.geometry.lng).toBe("number");
      } else if (r.geometry.kind === "zip_area") {
        expect(r.geometry.zip).toMatch(/^\d{5}$/);
      } else {
        expect(r.geometry).toEqual({ kind: "citywide" });
      }
    }
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("record ids are unique", () => {
    const data = loadCommunityInvestment()!;
    const ids = data.records.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("counts sum to the record total and dollars match the awarded sum", () => {
    const data = loadCommunityInvestment()!;
    const summed = Object.values(data.meta.counts).reduce((a, b) => a + b, 0);
    expect(summed).toBe(data.records.length);
    expect(data.meta.totalDollarsAwarded).toBe(sumAwardedDollars(data.records));
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("stores historical recovery lineage once and keeps its amounts out of amountAwarded", () => {
    const data = loadCommunityInvestment()!;
    expect(Object.keys(data.recoverySources).sort()).toEqual([
      "cook-source-2023",
      "illinois-b2b",
      "illinois-big",
      "illinois-hospitality-emergency",
      "sba-rrf",
    ]);
    const recoveryRecords = data.records.filter((record) => record.recovery);
    expect(recoveryRecords.length).toBe(
      data.meta.cookSourceChicagoRecords +
        data.meta.illinoisB2BChicagoRecords +
        data.meta.illinoisBigChicagoRecords +
        data.meta.illinoisHospitalityChicagoRecords +
        data.meta.sbaRrfChicagoRecords,
    );
    for (const record of recoveryRecords) {
      expect(record.amountAwarded).toBeNull();
      expect(record.recovery?.historicalAmount?.value).toBeGreaterThanOrEqual(0);
    }

    // The recovery-era dollars are a SEPARATE historical class, deliberately
    // excluded from the awarded hero figure. Assert the exclusion is total and
    // material, not merely implied by the per-record nulls above: these are
    // closed 2020-2023 relief programs (Illinois BIG, Illinois Hospitality
    // Emergency, Cook Source, Illinois B2B, SBA RRF), not grants awarded through
    // the ordinary pipeline, so folding them in would restate the headline by
    // hundreds of millions.
    const recoveryDollars = recoveryRecords.reduce(
      (sum, record) => sum + (record.recovery?.historicalAmount?.value ?? 0),
      0,
    );
    expect(recoveryDollars).toBeGreaterThan(500_000_000);
    expect(data.meta.totalDollarsAwarded).toBe(sumAwardedDollars(data.records));
    // Nothing in the awarded total came from a recovery record.
    expect(sumAwardedDollars(recoveryRecords)).toBe(0);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("PARTITIONS every 2020-relief source row into kept-for-Chicago or outside-Chicago", () => {
    // #97 added this identity for the DCEO counters after an out-of-bounds
    // geocode was found silently DELETING an appropriation while its counter
    // claimed the record was held. The same exposure exists here: both families
    // drop rows on a Chicago test, so the counters must still account for every
    // row the official source publishes. The totals are the ones reconciled
    // against the DCEO PDFs directly (BIG: 135pp / $276,275,000;
    // Hospitality: 12pp / $13,995,000).
    const data = loadCommunityInvestment()!;

    // Two rows are excluded by a deliberate cross-check rather than by a Chicago
    // municipality, and both land in the outside-Chicago counter rather than
    // vanishing: BIG's 60426 row (city reads Chicago, ZIP is Harvey) and
    // Hospitality's Hyatt House West Loop-Fulton Market row (city reads Chicago,
    // county reads Crawford — an error in the source document itself).
    expect(
      data.meta.illinoisBigChicagoRecords +
        data.meta.illinoisBigOutsideChicagoRecords,
    ).toBe(8_998);
    expect(
      data.meta.illinoisHospitalityChicagoRecords +
        data.meta.illinoisHospitalityOutsideChicagoRecords,
    ).toBe(699);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("holds the 2020 relief families at exactly the precision their sources publish", () => {
    const data = loadCommunityInvestment()!;

    // BIG publishes municipality + ZIP and no street address, so every retained
    // Chicago row is a ZIP aggregate — never a point. A point here would be
    // invented geography, and the ZIP polygons the map draws would disagree with
    // the records behind them.
    const big = data.records.filter((record) => record.source === "illinois-big");
    expect(big.length).toBe(data.meta.illinoisBigChicagoRecords);
    expect(big.length).toBeGreaterThan(0);
    expect(new Set(big.map((record) => record.geometry.kind))).toEqual(
      new Set(["zip_area"]),
    );
    // Every ZIP is a real Chicago ZIP: the one source row whose city reads
    // Chicago but whose ZIP is 60426 (Harvey) is excluded rather than drawn onto
    // a suburban polygon.
    for (const record of big) {
      if (record.geometry.kind === "zip_area") {
        expect(record.geometry.zip).toMatch(/^\d{5}$/);
        expect(record.geometry.zip).not.toBe("60426");
      }
    }

    // Hospitality publishes a municipality and NOTHING finer. Every Chicago row
    // therefore stays citywide: no ZIP, no centroid, no downtown pin.
    const hospitality = data.records.filter(
      (record) => record.source === "illinois-hospitality-emergency",
    );
    expect(hospitality.length).toBe(data.meta.illinoisHospitalityChicagoRecords);
    expect(hospitality.length).toBeGreaterThan(0);
    for (const record of hospitality) {
      expect(record.geometry).toEqual({ kind: "citywide" });
    }
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("announcedCapitalTotal matches the announcedInvestment sum and is a DIFFERENT figure from awarded", () => {
    const data = loadCommunityInvestment()!;
    expect(data.meta.announcedCapitalTotal).toBe(sumAnnouncedInvestment(data.records));
    // The two are truly separate — announced private capital dwarfs awarded grants
    // and is never folded in.
    expect(data.meta.announcedCapitalTotal).toBeGreaterThan(data.meta.totalDollarsAwarded);
    // announced capital lands in the expected ~$67–75B band.
    expect(data.meta.announcedCapitalTotal).toBeGreaterThan(60_000_000_000);
    expect(data.meta.announcedCapitalTotal).toBeLessThan(80_000_000_000);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("every development record carries NO awarded dollars (announced capital only)", () => {
    const data = loadCommunityInvestment()!;
    for (const r of data.records) {
      if (r.source === "development") {
        expect(r.amountAwarded).toBeNull();
      }
      // announcedInvestment only ever lives on development records.
      if (r.announcedInvestment != null) {
        expect(r.source).toBe("development");
      }
    }
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("IRON RULE: the raw committed text carries no banned derived-figure key", () => {
    // Read the raw file (not the typed loader) so a hand-edit can't slip past.
    const parsed = JSON.parse(readFileSync(EXPORT_PATH, "utf8"));
    expect(findBannedFigureKeys(parsed)).toEqual([]);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  // ── Capital-spine invariants over the committed export ──────────────────────

  it("no non-grant dollar leaked: awarded total is EXACTLY the grant-class amountAwarded sum, and every non-grant record has null amountAwarded", () => {
    const data = loadCommunityInvestment()!;
    // (a) totalDollarsAwarded === Σ amountAwarded over capitalClass==="grant" records
    //     EXACTLY. This is the real invariant "no non-grant dollar leaked" — and it
    //     is refresh-proof: a legitimate grant-data refresh moves BOTH sides together,
    //     whereas a non-grant dollar folded into the awarded total would move only the
    //     left side and trip this. (A pinned dollar constant tripped on every clean
    //     grant refresh and taught the reader to blindly re-pin it — removed.)
    const grantAwarded = data.records
      .filter((r) => r.capitalClass === "grant")
      .reduce((sum, r) => sum + (r.amountAwarded ?? 0), 0);
    expect(data.meta.totalDollarsAwarded).toBe(grantAwarded);
    // (b) every non-grant record contributes 0 because its amountAwarded is null —
    //     so a subsidy/federal/tax-credit dollar cannot enter the awarded total.
    for (const r of data.records) {
      if (r.capitalClass !== "grant") expect(r.amountAwarded).toBeNull();
    }
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("carries all five capital classes and each record's money lives in exactly one field", () => {
    const data = loadCommunityInvestment()!;
    const seen = new Set<string>();
    for (const r of data.records) {
      expect(CAPITAL_CLASSES).toContain(r.capitalClass);
      seen.add(r.capitalClass);
      const money = [
        r.amountAwarded != null,
        r.authorizedAmount != null,
        r.creditAmount != null,
        r.publishedBalance != null,
        r.announcedInvestment != null,
      ].filter(Boolean).length;
      expect(money).toBeLessThanOrEqual(1); // never two money fields on one record
      if (r.capitalClass === "tif_subsidy") {
        expect(r.source).toBe("tif");
        expect(r.amountAwarded).toBeNull();
        expect(r.creditAmount == null).toBe(true);
      }
      if (r.capitalClass === "federal_program") {
        expect(r.source).toBe("cdbg-home");
        expect(r.amountAwarded).toBeNull();
      }
      if (r.capitalClass === "tax_credit") {
        expect(["lihtc", "nmtc"]).toContain(r.source);
        expect(r.amountAwarded).toBeNull();
      }
      if (r.capitalClass === "state_appropriation") {
        expect(r.source).toBe("dceo-capital");
        expect(r.amountAwarded).toBeNull();
        if (r.geometry.kind === "point") {
          // DCEO points pass the official Chicago community-area polygon check,
          // not only a broad city bounding box.
          expect(r.communityArea).toBeTruthy();
        }
      }
    }
    expect([...seen].sort()).toEqual([
      "federal_program",
      "grant",
      "state_appropriation",
      "tax_credit",
      "tif_subsidy",
    ]);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("each new capital total matches an independent recompute from its own field", () => {
    const data = loadCommunityInvestment()!;
    expect(data.meta.totalAuthorizedTif).toBe(sumAuthorizedByClass(data.records, "tif_subsidy"));
    expect(data.meta.totalFederalProgram).toBe(sumAuthorizedByClass(data.records, "federal_program"));
    expect(data.meta.totalCreditCapital).toBe(sumCreditCapital(data.records));
    // The independent totals are meaningfully non-zero and distinct from awarded grants.
    expect(data.meta.totalAuthorizedTif).toBeGreaterThan(0);
    expect(data.meta.totalFederalProgram).toBeGreaterThan(0);
    expect(data.meta.totalCreditCapital).toBeGreaterThan(0);
    expect(data.meta.totalAuthorizedTif).not.toBe(data.meta.totalDollarsAwarded);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  /**
   * PR1 / consult Q5: a tif/cdbg-home/lihtc row with no usable coordinate is no
   * longer silently dropped — it is RETAINED as an unplotted citywide record
   * with an explicit locationReason (never a bare, unexplained "held-citywide").
   * Every OTHER geometry stays a plottable point; a citywide row in this trio
   * must always carry a reason, and a point row must never carry one.
   */
  it("every tif/cdbg-home/lihtc record is either a PLOTTABLE point or an explicitly-reasoned citywide hold", () => {
    const data = loadCommunityInvestment()!;
    for (const r of data.records) {
      if (r.source === "tif" || r.source === "cdbg-home" || r.source === "lihtc") {
        expect(["point", "citywide"]).toContain(r.geometry.kind);
        if (r.geometry.kind === "citywide") {
          expect(r.locationReason).not.toBeNull();
        } else {
          expect(r.locationReason ?? null).toBeNull();
        }
      }
    }
    expect(data.meta.heldTifUnlocatedRecords).toBeGreaterThan(0);
    expect(data.meta.heldAdministrativeOutsideCityRecords).toBeGreaterThan(0);
    expect(data.meta.heldLihtcUnlocatedRecords).toBeGreaterThan(0);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("NMTC is CA-stamped citywide: never a point, but carries a communityArea for analysis lists", () => {
    const data = loadCommunityInvestment()!;
    const nmtc = data.records.filter((r) => r.source === "nmtc");
    expect(nmtc.length).toBeGreaterThan(0);
    for (const r of nmtc) {
      // Never plots — the public NMTC file has no street address.
      expect(r.geometry.kind).toBe("citywide");
      // Its money is tax-credit capital, never an awarded grant.
      expect(r.capitalClass).toBe("tax_credit");
      expect(r.amountAwarded).toBeNull();
    }
    // The stamped subset carries a communityArea (so it reaches per-community lists);
    // the meta stamped/unstamped counts partition the NMTC records exactly.
    const stamped = nmtc.filter((r) => r.communityArea != null);
    expect(stamped.length).toBe(data.meta.nmtcCitywideStamped);
    expect(data.meta.nmtcCitywideStamped + data.meta.nmtcUnstamped).toBe(nmtc.length);
    expect(stamped.length).toBeGreaterThan(0);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  /**
   * PIN CONVERSION (2026-07, scheduled monthly refresh).
   *
   * Was: `expect(data.meta.droppedHudOutOfBbox).toBe(26)`.
   *
   * `hud_cpd_activities.csv` is re-pulled monthly from HUD's ArcGIS CDBG/HOME
   * layers, so an absolute drop count fails on any legitimate refresh — and it
   * did: the July 2026 pull moved it 26 → 19 when HUD republished the CDBG
   * layer. What the test actually cared about is that the Chicago bbox filter
   * REJECTS A TRICKLE AND KEEPS THE REST, and that nothing vanishes in between.
   * Both survive a refresh as a cross-file partition:
   *
   *   rows in the curated input === mapped cdbg-home records + bbox drops
   *
   * That identity is what a real regression breaks (a parser that eats rows, an
   * inverted bbox, a truncated fetch) while an ordinary month-over-month change
   * passes. The ≤2% ceiling preserves the original intent: a filter that starts
   * rejecting a flood is a bug, not a data update.
   */
  it("HUD bbox drops PARTITION the curated input against the mapped records", () => {
    const data = loadCommunityInvestment()!;
    const dropped = data.meta.droppedHudOutOfBbox;
    const mapped = countBySource(data.records)["cdbg-home"] ?? 0;

    expect(Number.isInteger(dropped)).toBe(true);
    expect(dropped).toBeGreaterThanOrEqual(0);

    // Cross-file reconciliation against the input the export actually read.
    const inputRows = countCuratedCsvRows("hud_cpd_activities.csv");
    expect(mapped + dropped).toBe(inputRows);

    // A trickle, not a flood — the filter's original intent.
    expect(dropped).toBeLessThanOrEqual(Math.ceil(inputRows * 0.02));
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  /**
   * The regression net under the monthly refresh. Absolute pins on these five
   * sources were removed (see REFRESHED_SOURCE_FLOORS) because they fail on any
   * honest upstream change; without SOMETHING in their place, the opposite
   * failure becomes silent — a source could quietly halve and the suite would
   * stay green. A 2% shrink tolerance is the seam: wide enough for corrections
   * and de-duplication upstream, narrow enough that a dropped cohort trips it.
   */
  it("no refreshed source has SHRUNK by more than 2% below its 2026-07 baseline", () => {
    const counts = countBySource(loadCommunityInvestment()!.records);
    const regressions: string[] = [];
    for (const { source, floorAsOf202607 } of REFRESHED_SOURCE_FLOORS) {
      const actual = counts[source] ?? 0;
      const minimum = Math.floor(floorAsOf202607 * 0.98);
      if (actual < minimum) {
        regressions.push(
          `${source}: ${actual} records, below the ${minimum} floor ` +
            `(2026-07 baseline ${floorAsOf202607}) — possible dataset regression. ` +
            `If the upstream loss is real and reviewed, re-baseline it in the PR that accepts the data.`,
        );
      }
    }
    expect(regressions).toEqual([]);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("a DCEO out-of-bounds geocode is HELD CITYWIDE, never deleted from the export", () => {
    const data = loadCommunityInvestment()!;
    const dceo = data.records.filter((r) => r.source === "dceo-capital");
    // The counters must PARTITION the retained records, which is only true if
    // no path deletes a row. An out-of-bounds geocode previously ran `continue`,
    // so the record vanished and this identity silently held on a smaller set.
    expect(dceo.length).toBe(data.meta.dceoChicagoRecords);
    expect(data.meta.dceoPointRecords + data.meta.dceoCitywideRecords).toBe(dceo.length);
    expect(data.meta.dceoPointRecords).toBe(
      dceo.filter((r) => r.geometry.kind === "point").length,
    );

    // The concrete row the review caught: a real $250,000 Board of Education
    // appropriation whose Census geocode landed in Lake County, ~55 km north.
    // The POINT is rejected; the appropriation stays, unplotted and auditable.
    const outOfBounds = dceo.filter((r) => r.address === "1059 WEST 13TH STREET");
    expect(outOfBounds).toHaveLength(1);
    expect(outOfBounds[0].recipient).toContain("BOARD OF EDUCATION");
    expect(outOfBounds[0].geometry).toEqual({ kind: "citywide" });
    expect(outOfBounds[0].publishedBalance).toBe(250_000);
    expect(data.meta.dceoAddressOutOfBounds).toBeGreaterThan(0);
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);

  it("multi-site DCEO rows stay UNPLOTTED, per the README location-precision contract", () => {
    const data = loadCommunityInvestment()!;
    const dceo = data.records.filter((r) => r.source === "dceo-capital");
    // Two house numbers sharing one street suffix collapse to a single regex
    // match, so these two shipped as confident points at one of the two sites.
    for (const name of ["IN HIS HANDS GLOBAL MINISTRIES", "Irving Park Community Food Pantry"]) {
      const row = dceo.find((r) => r.recipient.includes(name));
      expect(row, `expected a DCEO row for ${name}`).toBeDefined();
      expect(row!.geometry).toEqual({ kind: "citywide" });
      // No safe single address survives, so none is published on the record.
      expect(row!.address).toBeNull();
    }
    expect(data.meta.dceoMultiSiteHeldCitywide).toBeGreaterThanOrEqual(2);
    // Every DCEO POINT carries exactly one source-literal address.
    for (const r of dceo) {
      if (r.geometry.kind === "point") expect(r.address).toBeTruthy();
    }
  }, COMMITTED_EXPORT_INVARIANT_TIMEOUT_MS);
});

// ── Committed capital-context.json (context aggregates, banned-key rail) ───────

const CONTEXT_PATH = path.join(process.cwd(), "data/private/capital-context.json");
const CONTEXT_EXISTS = existsSync(CONTEXT_PATH);

describe.skipIf(!CONTEXT_EXISTS)("committed capital-context.json", () => {
  it("comes from the same export run as the committed investment records", () => {
    const investment = JSON.parse(readFileSync(EXPORT_PATH, "utf8"));
    const context = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"));

    expect(context.generatedAt).toBe(investment.generatedAt);
  });

  it("IRON RULE: the raw context text carries no banned derived-figure key", () => {
    const parsed = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"));
    expect(findBannedFigureKeys(parsed)).toEqual([]);
  });

  it("carries context series, Illinois arts awards, Chicago ARPA, and the SFY2027 caveat", () => {
    const ctx = JSON.parse(readFileSync(CONTEXT_PATH, "utf8"));
    expect(Array.isArray(ctx.tifDistricts)).toBe(true);
    expect(ctx.tifDistricts.length).toBeGreaterThan(0);
    expect(Array.isArray(ctx.craByCommunityArea)).toBe(true);
    expect(Array.isArray(ctx.cdfi)).toBe(true);
    expect(ctx.illinoisArtsCouncilAwards.sourceVersion).toBe("FY2026 Q1");
    expect(ctx.illinoisArtsCouncilAwards.fundingPurpose).toBe("arts");
    expect(ctx.illinoisArtsCouncilAwards.recordCount).toBe(670);
    expect(ctx.illinoisArtsCouncilAwards.records).toHaveLength(670);
    expect(
      ctx.illinoisArtsCouncilAwards.records.reduce(
        (sum: number, record: { grantAmount: number }) => sum + record.grantAmount,
        0,
      ),
    ).toBe(9_162_720);
    expect(ctx.illinoisArtsCouncilAwards.coverage).toEqual({
      capture: "complete_published",
      mapDetail: "aggregate_only",
      refresh: "awaiting_publication",
      review: "complete_published",
    });
    expect(
      ctx.illinoisArtsCouncilAwards.records.every(
        (record: Record<string, unknown>) =>
          record.city === "Chicago" &&
          !("address" in record) &&
          !("postalCode" in record) &&
          !("lat" in record) &&
          !("lng" in record),
      ),
    ).toBe(true);
    expect(ctx.dceoFundingLifecycle.stages.map(
      (stage: { id: string }) => stage.id,
    )).toEqual([
      "proposed_budget",
      "enacted_authority",
      "appropriation_register",
      "funding_opportunity",
      "executed_award",
      "disbursement",
    ]);
    expect(ctx.dceoFundingLifecycle.policy.amountCombinationPolicy).toBe(
      "never_sum_across_lifecycle_stages",
    );
    expect(ctx.stateAwards.fiscalYear).toBe(2027);
    // The award-not-payment + low-recall caveats travel with the summary.
    expect(String(ctx.stateAwards.snapshotCaveat)).toMatch(/SFY2027|not naively summed/i);
    expect(String(ctx.stateAwards.amountMeaning)).toMatch(/not money paid/i);
    expect(Array.isArray(ctx.stateAwards.topGrantees)).toBe(true);
    expect(ctx.chicagoArpaRecovery.classification.id).toBe(
      "chicago-arpa-program",
    );
    expect(ctx.chicagoArpaRecovery.programs).toHaveLength(77);
    expect(
      ctx.chicagoArpaRecovery.programs.filter(
        (program: { historicalAllocated: number | null }) =>
          program.historicalAllocated === null,
      ),
    ).toHaveLength(10);
    // PIN CONVERSION (2026-07, scheduled monthly refresh).
    // Was: `.toHaveLength(101)`. The ledger is rebuilt monthly from Socrata
    // rsxa-ify5 + iyu8-jkf8, so its total is live-derived and an absolute
    // length breaks on any legitimate refresh. The meaningful claim is that the
    // three record kinds PARTITION the ledger exactly — no record is untyped,
    // double-counted, or silently dropped — with the one genuinely fixed number
    // (7 curated programs, a constant in lib/chicago-cares-program-ledger.ts,
    // not a Socrata row) still pinned, and floors under the two live kinds so
    // an empty pull cannot pass as a valid ledger.
    {
      const kinds = ctx.chicagoCaresProgramLedger.records.map(
        (record: { recordKind: string }) => record.recordKind,
      );
      const count = (kind: string) => kinds.filter((k: string) => k === kind).length;
      expect(count("program") + count("program_administrator") + count("program_accounting")).toBe(
        kinds.length,
      );
      expect(count("program")).toBe(7); // curated constant, not a live row count
      expect(count("program_administrator")).toBeGreaterThan(0);
      expect(kinds.length).toBeGreaterThan(7);
    }
    expect(
      ctx.chicagoCaresProgramLedger.records.every(
        (record: {
          isBusinessRecipient: boolean;
          isMappableBusinessLocation: boolean;
          financialAggregationPolicy: string;
        }) =>
          record.isBusinessRecipient === false &&
          record.isMappableBusinessLocation === false &&
          record.financialAggregationPolicy === "never_sum_across_records",
      ),
    ).toBe(true);
    // PIN CONVERSION (2026-07, scheduled monthly refresh).
    // Was: `.toHaveLength(17)`. These accounting rows come from the CDBG-CV
    // mid-year-grants query (iyu8-jkf8, project codes CARES20CD / CARES20DB),
    // so the count moves whenever the City republishes. The invariant that
    // matters is that the accounting rows EXIST and each one carries the
    // never-sum policy that keeps budget/encumbrance/expenditure stages apart —
    // the honesty rail, which a corrupt or partial pull would break.
    {
      const accounting = ctx.chicagoCaresProgramLedger.records.filter(
        (record: { recordKind: string }) => record.recordKind === "program_accounting",
      );
      expect(accounting.length).toBeGreaterThan(0);
      expect(
        accounting.every(
          (record: { financialAggregationPolicy: string }) =>
            record.financialAggregationPolicy === "never_sum_across_records",
        ),
      ).toBe(true);
    }
    expect(ctx.cookCountyCares2020.programs).toHaveLength(4);
    expect(
      ctx.cookCountyCares2020.programs.every(
        (program: {
          cityOfChicagoAwardEligible: boolean;
          mappable: boolean;
        }) =>
          program.cityOfChicagoAwardEligible === false &&
          program.mappable === false,
      ),
    ).toBe(true);
    const cookUmbrella = ctx.cookCountyCares2020.programs.find(
      (program: { recordKind: string }) =>
        program.recordKind === "umbrella_program_context",
    );
    expect(cookUmbrella.historicalPortfolioAmount).toBe(77_000_000);
    expect(cookUmbrella.historicalDirectRecipientAmount).toBeNull();
  });
});
