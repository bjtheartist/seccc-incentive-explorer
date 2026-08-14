import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/**
 * Sol gate blocker 5 — page-level contract tests for the landing page's
 * meta-driven consumers, using DELIBERATELY DISJOINT fixture values so a
 * regression (e.g. a caller reading the wrong total, or reverting to a
 * hand-typed literal) shows up as a wrong number in the rendered HTML, not
 * merely "the component renders." This is the class of test that would have
 * caught blocker 2 (StatusCards receiving the citywide appropriation total
 * on a scoped page) had it existed for the AREA/PRINT pages too — see the
 * companion tests in app/investment/[area]/page.test.ts and
 * app/print/investment/[area]/page.test.ts for those two callers.
 */

vi.mock("@/app/investment/gate", () => ({
  getInvestmentAdminState: vi.fn(),
  InvestmentLoginForm: function InvestmentLoginForm() {
    return null;
  },
  InvestmentNotConfigured: function InvestmentNotConfigured() {
    return null;
  },
}));

vi.mock("@/lib/community-investment", () => ({
  loadCommunityInvestment: vi.fn(),
}));

vi.mock("@/lib/investment-analysis", () => ({
  loadInvestmentIndex: vi.fn(),
  loadMajorDevelopments: vi.fn(() => ({ count: 0, totalAnnounced: 0, developments: [] })),
  loadIllinoisArtsCouncilAwards: vi.fn(() => null),
}));

vi.mock("@/lib/investment-source-coverage", () => ({
  // Not under test here — the coverage matrix has its own tests. Returning []
  // keeps that (unrelated) section out of the rendered output.
  buildSourceCoverageRows: vi.fn(() => []),
}));

import * as gate from "@/app/investment/gate";
import { loadCommunityInvestment } from "@/lib/community-investment";
import { loadInvestmentIndex } from "@/lib/investment-analysis";
import type { CommunityInvestmentExport } from "@/lib/community-investment";
import type { CommunityInvestmentIndex } from "@/lib/investment-analysis";
import Page from "./page";

const mockState = vi.mocked(gate.getInvestmentAdminState);
const mockLoadCommunityInvestment = vi.mocked(loadCommunityInvestment);
const mockLoadInvestmentIndex = vi.mocked(loadInvestmentIndex);

/**
 * DELIBERATELY DISJOINT fixture meta — every field below is a distinct,
 * memorable value with no two totals sharing a digit pattern, so a caller
 * that reads the wrong field produces an assertion failure, not a
 * coincidental pass. Cast through `unknown` — CommunityInvestmentMeta has ~70
 * fields; only the ones the landing page actually reads are populated.
 */
const FIXTURE_META = {
  totalDollarsAwarded: 111_000_000,
  announcedCapitalTotal: 222_000_000,
  totalAuthorizedTif: 333_000_000,
  totalFederalProgram: 444_000_000,
  totalCreditCapital: 555_000_000,
  totalPublishedStateAppropriation: 666_000_000,
  totalRecoveryHistorical: 777_000_000,
  citywideCount: 888,
  // Bridge — disjoint order values (audit finding 8 / consult Q4). Chosen so
  // full - noCA - pre2020 = hero EXACTLY, and every number is distinguishable.
  bridgeFullAwardedDollars: 900_000_000,
  bridgeFullAwardedRows: 9_000,
  bridgeNoCommunityAreaDollars: 150_000_000,
  bridgeNoCommunityAreaRows: 1_500,
  bridgePre2020SitedDollars: 50_000_000,
  bridgePre2020SitedRows: 500,
  bridgeDisplayedHeroDollars: 700_000_000, // 900M - 150M - 50M
  bridgeDisplayedHeroRows: 7_000, // 9000 - 1500 - 500
  // Dedupe ledger (audit finding 4 / consult F4 + Q1).
  dedupeCandidateGroups: 236,
  dedupeCollapsedRows: 268,
  dedupeCollapsedDollars: 11_842_767,
  dedupeKeptFlaggedGroups: 100,
  dedupeKeptFlaggedRows: 236,
  dedupeKeptFlaggedDollars: 5_000_000,
} as unknown as CommunityInvestmentExport["meta"];

const FIXTURE_INVESTMENT: CommunityInvestmentExport = {
  generatedAt: "2026-08-14T00:00:00.000Z",
  recoverySources: {},
  meta: FIXTURE_META,
  records: [],
};

const FIXTURE_INDEX: CommunityInvestmentIndex = {
  generatedAt: "2026-08-14T00:00:00.000Z",
  citywideTotal: 700_000_000,
  communityCount: 2,
  rows: [
    {
      communityArea: "Fixture Top Community",
      totalAwarded: 500_000_000,
      recordCount: 40,
      unYeared: 2,
      creditCapital: 1_000_000,
      foundationDollars: 400_000_000, // 80% foundation share
    },
    {
      communityArea: "Fixture Second Community",
      totalAwarded: 200_000_000,
      recordCount: 10,
      unYeared: 0,
      creditCapital: 0,
      foundationDollars: 0,
    },
  ],
};

async function render(): Promise<string> {
  const el = (await Page({ searchParams: Promise.resolve({}) } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}

describe("/investment landing page — meta-driven contracts (Sol gate blocker 5)", () => {
  beforeEach(() => {
    mockState.mockReset().mockResolvedValue({ configured: true, hasSession: true });
    mockLoadCommunityInvestment.mockReset().mockReturnValue(FIXTURE_INVESTMENT);
    mockLoadInvestmentIndex.mockReset().mockReturnValue(FIXTURE_INDEX);
  });

  it("renders the corrected headline — 'Where award recipients are located', never 'Where the money went'", async () => {
    const html = await render();
    expect(html).toContain("Where award recipients are located");
    expect(html).not.toContain("Where the money went");
  });

  it("renders the full-awarded → hero bridge in the disjoint order, with the fixture's exact values", async () => {
    const html = await render();
    expect(html).toContain("$900,000,000");
    expect(html).toContain("9,000 rows");
    expect(html).toContain("$150,000,000");
    expect(html).toContain("1,500 rows with no community area");
    expect(html).toContain("$50,000,000");
    expect(html).toContain("500 community-sited rows before 2020");
    expect(html).toContain("$700,000,000");
    // The bridge's own sentence carries all four numbers in this EXACT
    // disjoint order — anchored to the bridge sentence itself (not the whole
    // page) so this can't accidentally pass off an unrelated occurrence of
    // the same digits elsewhere (the hero figure, by construction, also
    // equals index.citywideTotal shown in StatusCards).
    const anchor = html.indexOf("Full awarded dollars:");
    expect(anchor).toBeGreaterThan(-1);
    const bridgeSentence = html.slice(anchor, anchor + 400);
    const bridgeOrder = ["$900,000,000", "$150,000,000", "$50,000,000", "$700,000,000"].map((v) =>
      bridgeSentence.indexOf(v),
    );
    expect(bridgeOrder.every((i) => i >= 0)).toBe(true);
    expect(bridgeOrder).toEqual([...bridgeOrder].sort((a, b) => a - b));
  });

  it("StatusCards on landing uses the CITYWIDE scope — this is the caller that SHOULD show meta.totalRecoveryHistorical and meta.totalPublishedStateAppropriation", async () => {
    const html = await render();
    // F5 sentence, live total.
    expect(html).toContain(
      "Closed recovery-program files report $777.0M disbursed; ordinary award, foundation, TIF, HUD, tax-credit, and appropriation sources do not report recipient receipts.",
    );
    expect(html).not.toContain("Not shown on this page");
    // Fifth capital class — citywide meta total (compact display), since this
    // IS the landing caller.
    expect(html).toContain("$666.0M");
  });

  it("renders the landing dedupe/methodology copy from meta.dedupe*, matching the fixture exactly", async () => {
    const html = await render();
    expect(html).toContain("Foundation duplicate review");
    expect(html).toContain("236 groups");
    expect(html).toContain("268 rows");
    expect(html).toContain("$11,842,767");
    expect(html).toContain("236 rows across");
    expect(html).toContain("100 groups");
    expect(html).toContain("$5,000,000");
    expect(html).toContain(
      "Two source line items; award-level distinctness not independently verified",
    );
  });

  it("renders the rank disclosure quantified from the #1 row's OWN foundationDollars (not a hand-typed 'Loop' literal)", async () => {
    const html = await render();
    expect(html).toContain("Fixture Top Community");
    expect(html).toContain("$400,000,000");
    expect(html).toContain("$500,000,000");
    expect(html).toContain("80.0%");
  });
});
