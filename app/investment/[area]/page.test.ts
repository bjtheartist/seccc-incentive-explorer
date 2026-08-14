import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/**
 * Sol gate blocker 5 / blocker 2 regression guard — the area page's
 * StatusCards MUST receive the COMMUNITY-scoped published appropriation
 * balance (analysis.publishedStateAppropriation), never
 * meta.totalPublishedStateAppropriation (the citywide total). The fixture
 * deliberately sets these to DIFFERENT, memorable values so a caller that
 * regresses to the citywide total fails this test with the citywide number
 * showing up where the community number should be — this is the class of
 * test that would have caught the original finding.
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

vi.mock("@/components/investment/FunderFlowSankey", () => ({
  FunderFlowSankey: function FunderFlowSankey() {
    return null;
  },
}));

vi.mock("@/lib/community-investment", () => ({
  loadCommunityInvestment: vi.fn(),
}));

vi.mock("@/lib/investment-analysis", () => ({
  loadInvestmentAnalysis: vi.fn(),
  loadMajorDevelopments: vi.fn(() => ({ count: 0, totalAnnounced: 0, developments: [] })),
  loadFlowRows: vi.fn(() => []),
}));

import * as gate from "@/app/investment/gate";
import { loadCommunityInvestment } from "@/lib/community-investment";
import { loadInvestmentAnalysis } from "@/lib/investment-analysis";
import type { CommunityInvestmentExport } from "@/lib/community-investment";
import type { CommunityInvestmentAnalysis } from "@/lib/investment-analysis";
import Page from "./page";

const mockState = vi.mocked(gate.getInvestmentAdminState);
const mockLoadCommunityInvestment = vi.mocked(loadCommunityInvestment);
const mockLoadInvestmentAnalysis = vi.mocked(loadInvestmentAnalysis);

const AREA = "South Shore";

// DELIBERATELY DISJOINT: the citywide meta figure ($715,300,000 — evokes the
// real $715.3M) is a completely different value from this community's own
// sited subset ($42,000) — no shared digits, so a regression to the citywide
// figure cannot coincidentally pass.
const CITYWIDE_APPROPRIATION_META_FIGURE = 715_300_000;
const COMMUNITY_SITED_APPROPRIATION = 42_000;

const FIXTURE_META = {
  totalPublishedStateAppropriation: CITYWIDE_APPROPRIATION_META_FIGURE,
  totalRecoveryHistorical: 923_400_000,
  sources: ["Fixture source list"],
  nmtcUnstamped: 0,
  droppedHudOutOfBbox: 0,
} as unknown as CommunityInvestmentExport["meta"];

const FIXTURE_INVESTMENT: CommunityInvestmentExport = {
  generatedAt: "2026-08-14T00:00:00.000Z",
  recoverySources: {},
  meta: FIXTURE_META,
  records: [],
};

function fixtureAnalysis(publishedStateAppropriation: number): CommunityInvestmentAnalysis {
  return {
    communityArea: AREA,
    generatedAt: "2026-08-14T00:00:00.000Z",
    totalAwarded: 12_000_000,
    medianAward: 50_000,
    announcedCapital: 0,
    authorizedTif: 0,
    federalProgram: 0,
    creditCapital: 0,
    publishedStateAppropriation,
    recordCount: 10,
    unYeared: 0,
    span: { min: 2020, max: 2026 },
    latestYear: 2026,
    byFunderType: [],
    byYear: [],
    bySource: [],
    governmentFundingPurposes: [],
    topRecipients: [],
    topFunders: [],
    equity: {
      rank: 1,
      totalCAs: 77,
      citywideMedianCA: 1,
      thisVsMedian: 1,
      citywideTotal: 12_000_000,
      share: 1,
      foundationDollars: 0,
      foundationShare: 0,
    },
  };
}

async function render(): Promise<string> {
  const el = (await Page({
    params: Promise.resolve({ area: AREA }),
    searchParams: Promise.resolve({}),
  } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}

describe("/investment/[area] page — StatusCards scope (Sol gate blockers 2 + 5)", () => {
  beforeEach(() => {
    mockState.mockReset().mockResolvedValue({ configured: true, hasSession: true });
    mockLoadCommunityInvestment.mockReset().mockReturnValue(FIXTURE_INVESTMENT);
    mockLoadInvestmentAnalysis.mockReset();
  });

  it("a community WITH sited appropriation rows shows EXACTLY its own subset sum, never the citywide meta figure", async () => {
    mockLoadInvestmentAnalysis.mockReturnValue(fixtureAnalysis(COMMUNITY_SITED_APPROPRIATION));
    const html = await render();
    // StatusCards' capital-class row renders compact ("$42K" for $42,000).
    expect(html).toContain("$42K");
    // The citywide meta figure must not leak onto this page at all — neither
    // full nor compact form.
    expect(html).not.toContain("715,300,000");
    expect(html).not.toContain("$715.3M");
  });

  it("a community with ZERO sited appropriation rows shows zero/absence, not the citywide $715.3M-style figure", async () => {
    mockLoadInvestmentAnalysis.mockReturnValue(fixtureAnalysis(0));
    const html = await render();
    // StatusCards' CapitalClassStat renders "None on record" for a
    // non-positive value — never a fabricated $0 and never the citywide total.
    expect(html).toContain("None on record");
    expect(html).not.toContain("715,300,000");
    expect(html).not.toContain("$715.3M");
    expect(html).not.toContain("$715,300,000");
  });

  it("the disbursement card is scope 'not-applicable' — never implies the citywide recovery total belongs to this community", async () => {
    mockLoadInvestmentAnalysis.mockReturnValue(fixtureAnalysis(COMMUNITY_SITED_APPROPRIATION));
    const html = await render();
    expect(html).toContain("Not shown on this page");
    // The citywide recovery total must never render on a community page.
    expect(html).not.toContain("923,400,000");
    expect(html).not.toContain("$923.4M");
  });
});
