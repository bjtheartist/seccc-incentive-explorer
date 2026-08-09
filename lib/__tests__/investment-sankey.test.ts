import { describe, expect, it } from "vitest";
import { findBannedFigureKeys, type CommunityInvestmentRecord } from "../community-investment";
import {
  buildFunderFlow,
  OTHER_FUNDERS_LABEL,
  OTHER_RECIPIENTS_LABEL,
  type FunderFlowNode,
} from "../investment-sankey";

/** Minimal record factory (mirrors the investment-analysis test fixture). */
function rec(over: Partial<CommunityInvestmentRecord> & { id: string }): CommunityInvestmentRecord {
  const funderType = over.funderType ?? "government";
  return {
    source: "sbif",
    funderType,
    governmentFundingPurpose:
      over.governmentFundingPurpose !== undefined
        ? over.governmentFundingPurpose
        : funderType === "government"
          ? "capital_project"
          : null,
    funderName: "City of Chicago",
    recipient: "Test Grantee",
    amountAwarded: 100000,
    logLine: null,
    year: 2022,
    geometry: { kind: "point", lat: 41.7, lng: -87.6 },
    address: "1 MAIN ST",
    status: "completed",
    communityArea: "Zeta",
    capitalClass: "grant",
    links: [],
    ...over,
  };
}

/**
 * Zeta fixture — 8 funders (F1..F8) and 10 recipients (R1..R10), plus records
 * that MUST be excluded from the flow (pre-2020, null-year, null-amount).
 *
 * Funder totals: F1=950k, F2=950k, F3=600k, F4=500k, F5=400k, F6=300k, F7=200k,
 *   F8=100k  → top 6 = F1..F6; F7+F8 fold into "Other funders" = 300k.
 * Recipient totals: R1=800,R2=700,R3=600,R4=500,R5=400,R6=300,R10=250,R7=200,
 *   R9=150,R8=100 (k) → top 8 keep the first eight; R9+R8 fold into
 *   "Other recipients" = 250k.
 * Total awarded flowing = 4,000,000.
 */
const RECORDS: CommunityInvestmentRecord[] = [
  rec({ id: "1", funderName: "F1", recipient: "R1", source: "sbif", amountAwarded: 800000 }),
  rec({ id: "2", funderName: "F2", recipient: "R2", source: "sbif", amountAwarded: 700000 }),
  rec({ id: "3", funderName: "F3", recipient: "R3", source: "nof-small", amountAwarded: 600000 }),
  rec({ id: "4", funderName: "F4", recipient: "R4", source: "nof-small", amountAwarded: 500000 }),
  rec({ id: "5", funderName: "F5", recipient: "R5", source: "cdg", amountAwarded: 400000 }),
  rec({ id: "6", funderName: "F6", recipient: "R6", source: "cdg", amountAwarded: 300000 }),
  rec({ id: "7", funderName: "F7", recipient: "R7", source: "sbif", amountAwarded: 200000 }),
  rec({ id: "8", funderName: "F8", recipient: "R8", source: "sbif", amountAwarded: 100000 }),
  // F1 & F2 also give a philanthropic grant (smaller than their gov dollars, so
  // their dominant funderType stays government).
  rec({ id: "9", funderName: "F1", recipient: "R9", source: "foundation", funderType: "philanthropic", amountAwarded: 150000 }),
  rec({ id: "10", funderName: "F2", recipient: "R10", source: "foundation", funderType: "philanthropic", amountAwarded: 250000 }),
  // ── excluded: pre-2020, null-year, null-amount, zero-amount ──
  rec({ id: "x1", funderName: "F1", recipient: "R1", source: "sbif", year: 2018, amountAwarded: 999000 }),
  rec({ id: "x2", funderName: "Dev Co", recipient: "Big Project", source: "development", funderType: "private_development", year: null, amountAwarded: null }),
  rec({ id: "x3", funderName: "F3", recipient: "R3", source: "foundation", funderType: "philanthropic", amountAwarded: null }),
  rec({ id: "x4", funderName: "F4", recipient: "R4", source: "nof-large", amountAwarded: 0 }),
];

// Folding mechanics are exercised at an explicit threshold of 6 so the
// fixture (8 funders) folds regardless of the production default.
const flow = buildFunderFlow(RECORDS, "Zeta", { topFunders: 6 });

const funderNodes = flow.nodes.filter((n) => n.kind === "funder");
const sourceNodes = flow.nodes.filter((n) => n.kind === "source");
const recipientNodes = flow.nodes.filter((n) => n.kind === "recipient");
const linkValue = (source: string, target: string) =>
  flow.links.find((l) => l.source === source && l.target === target)?.value;

describe("buildFunderFlow — totals & exclusions", () => {
  it("sums only in-window, positive awarded dollars (pre-2020 / null-year / null / zero excluded)", () => {
    expect(flow.total).toBe(4_000_000);
  });

  it("conserves flow: funder side == source side == recipient side == total", () => {
    const sum = (nodes: FunderFlowNode[]) => nodes.reduce((s, n) => s + n.value, 0);
    expect(sum(funderNodes)).toBe(4_000_000);
    expect(sum(sourceNodes)).toBe(4_000_000);
    expect(sum(recipientNodes)).toBe(4_000_000);
  });

  it("link width equals awarded dollars", () => {
    expect(linkValue("f:F1", "s:sbif")).toBe(800000);
    expect(linkValue("s:sbif", "r:R1")).toBe(800000);
    expect(linkValue("f:F2", "s:foundation")).toBe(250000);
  });

  it("EXCLUDES an enriched development from the flow (announced capital is never a flow width)", () => {
    // A megadev now carries a real year + a multi-billion announcedInvestment, but
    // its amountAwarded is null — the sankey is awarded-dollars only, so it must
    // add no node, no link, and no dollars.
    const withDev = buildFunderFlow(
      [
        rec({ id: "a", funderName: "F1", recipient: "R1", source: "sbif", amountAwarded: 800000 }),
        rec({
          id: "mega",
          funderName: "United Center JV",
          recipient: "1901 Project",
          source: "development",
          funderType: "private_development",
          year: 2024,
          amountAwarded: null,
          announcedInvestment: 7_000_000_000,
        }),
      ],
      "Zeta",
    );
    expect(withDev.total).toBe(800000);
    expect(withDev.nodes.some((n) => n.key === "1901 Project" || n.key === "development")).toBe(false);
    expect(withDev.nodes.some((n) => n.key === "United Center JV")).toBe(false);
  });
});

describe("buildFunderFlow — folding", () => {
  it("keeps the top N funders and folds the rest into one bucket", () => {
    expect(flow.foldedFunders).toBe(2);
    const other = funderNodes.find((n) => n.isOther);
    expect(other?.key).toBe(OTHER_FUNDERS_LABEL);
    expect(other?.value).toBe(300000); // F7 200k + F8 100k
    expect(other?.funderType).toBeUndefined(); // a mixed bucket carries no identity color
    // Named funders are exactly F1..F6.
    expect(funderNodes.filter((n) => !n.isOther).map((n) => n.key)).toEqual(["F1", "F2", "F3", "F4", "F5", "F6"]);
  });

  it("keeps the top 8 recipients and folds the rest into one bucket", () => {
    expect(flow.foldedRecipients).toBe(2);
    const other = recipientNodes.find((n) => n.isOther);
    expect(other?.key).toBe(OTHER_RECIPIENTS_LABEL);
    expect(other?.value).toBe(250000); // R9 150k + R8 100k
  });

  it("routes folded funders' and recipients' dollars through the buckets", () => {
    // F7 (200k) + F8 (100k) both flow via sbif → the Other-funders bucket.
    expect(linkValue(`f:${OTHER_FUNDERS_LABEL}`, "s:sbif")).toBe(300000);
    // R9 (150k, via foundation) folds into Other recipients.
    expect(linkValue("s:foundation", `r:${OTHER_RECIPIENTS_LABEL}`)).toBe(150000);
    // R8 (100k, via sbif) folds into Other recipients.
    expect(linkValue("s:sbif", `r:${OTHER_RECIPIENTS_LABEL}`)).toBe(100000);
  });
});

describe("buildFunderFlow — ordering", () => {
  it("orders each column by dollars desc, with the Other bucket pinned last", () => {
    const named = funderNodes.filter((n) => !n.isOther).map((n) => n.value);
    expect(named).toEqual([...named].sort((a, b) => b - a));
    expect(funderNodes[funderNodes.length - 1].isOther).toBe(true);
    expect(recipientNodes[recipientNodes.length - 1].isOther).toBe(true);
  });

  it("orders source nodes by dollars desc (canonical-order tiebreak)", () => {
    // sbif 1.8M (800+700+200+100), nof-small 1.1M (600+500), cdg 700k (400+300), foundation 400k (150+250).
    expect(sourceNodes.map((n) => [n.key, n.value])).toEqual([
      ["sbif", 1_800_000],
      ["nof-small", 1_100_000],
      ["cdg", 700_000],
      ["foundation", 400_000],
    ]);
  });

  it("picks each funder's dominant funderType by dollars", () => {
    // F1: 800k government vs 150k philanthropic → government.
    expect(funderNodes.find((n) => n.key === "F1")?.funderType).toBe("government");
  });

  it("every link references a real node id", () => {
    const ids = new Set(flow.nodes.map((n) => n.name));
    for (const l of flow.links) {
      expect(ids.has(l.source)).toBe(true);
      expect(ids.has(l.target)).toBe(true);
    }
  });

  it("computes share as value / total", () => {
    const f1 = funderNodes.find((n) => n.key === "F1");
    expect(f1?.share).toBeCloseTo(950000 / 4000000, 10);
  });
});

describe("buildFunderFlow — iron rule & empty state", () => {
  it("produces an output free of banned derived-figure keys", () => {
    expect(findBannedFigureKeys(flow)).toEqual([]);
  });

  it("returns an empty flow when nothing qualifies (only dev / null-amount rows)", () => {
    const empty = buildFunderFlow(
      [
        rec({ id: "d1", source: "development", funderType: "private_development", year: null, amountAwarded: null }),
        rec({ id: "d2", amountAwarded: null }),
      ],
      "Empty CA",
    );
    expect(empty.total).toBe(0);
    expect(empty.nodes).toEqual([]);
    expect(empty.links).toEqual([]);
    expect(empty.foldedFunders).toBe(0);
    expect(empty.foldedRecipients).toBe(0);
  });
});
