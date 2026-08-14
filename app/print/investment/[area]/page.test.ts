import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/**
 * Print-brief GATE behavior. The page delegates its admin check to
 * getInvestmentAdminState() (the shared Owner Files gate). We mock that module
 * so we can drive the two gate branches without a request scope, and stub the
 * echarts-backed sankey so importing the page never loads the chart engine.
 *
 * The "StatusCards scope" describe block below additionally mocks the data
 * loaders with a DELIBERATELY DISJOINT fixture (Sol gate blocker 5) — this is
 * the THIRD of the three StatusCards callers (landing / area / print) that
 * must each be verified independently, since blocker 2 was exactly a print
 * (and area) page silently receiving the citywide figure meant for landing.
 */

vi.mock("@/app/investment/gate", () => ({
  getInvestmentAdminState: vi.fn(),
  InvestmentNotConfigured: function InvestmentNotConfigured() {
    return null;
  },
  InvestmentLoginForm: function InvestmentLoginForm() {
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
  loadFlowRows: vi.fn(() => []),
  loadCapitalContextForArea: vi.fn(() => ({
    communityArea: "South Shore",
    cra: null,
    cdfi: null,
    sources: [],
    generatedAt: null,
  })),
  computeInvestmentFindings: vi.fn(() => ["Fixture finding one.", "Fixture finding two.", "Fixture finding three."]),
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

type GateProps = { redirectTo?: string; hasAuthError?: boolean };

function render(area = "South Shore", searchParams: Record<string, string> = {}) {
  return Page({
    params: Promise.resolve({ area }),
    searchParams: Promise.resolve(searchParams),
  }) as Promise<ReactElement<GateProps>>;
}

describe("GET /print/investment/[area] — gate", () => {
  beforeEach(() => {
    mockState.mockReset();
  });

  it("renders the not-configured screen when the admin gate is unset", async () => {
    mockState.mockResolvedValue({ configured: false, hasSession: false });
    const el = await render();
    expect(el.type).toBe(gate.InvestmentNotConfigured);
  });

  it("renders the password wall (no session) and never reaches the brief", async () => {
    mockState.mockResolvedValue({ configured: true, hasSession: false });
    const el = await render("South Shore");
    expect(el.type).toBe(gate.InvestmentLoginForm);
    // Redirects into the /investment tree (the login route only allows that path).
    expect(el.props.redirectTo).toBe("/investment/South Shore");
    expect(el.props.hasAuthError).toBe(false);
  });

  it("passes an error flag through to the password wall", async () => {
    mockState.mockResolvedValue({ configured: true, hasSession: false });
    const el = await render("South Shore", { error: "1" });
    expect(el.type).toBe(gate.InvestmentLoginForm);
    expect(el.props.hasAuthError).toBe(true);
  });
});

describe("GET /print/investment/[area] — StatusCards scope (Sol gate blockers 2 + 5, third caller)", () => {
  // DELIBERATELY DISJOINT from the landing/area fixtures above and from each
  // other — no shared digits, so a caller reading the wrong field cannot
  // coincidentally pass.
  const CITYWIDE_APPROPRIATION_META_FIGURE = 715_300_000;
  const COMMUNITY_SITED_APPROPRIATION = 8_500;

  const FIXTURE_META = {
    totalPublishedStateAppropriation: CITYWIDE_APPROPRIATION_META_FIGURE,
    totalRecoveryHistorical: 923_400_000,
    sources: ["Fixture print source list"],
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
      communityArea: "South Shore",
      generatedAt: "2026-08-14T00:00:00.000Z",
      totalAwarded: 3_000_000,
      medianAward: 25_000,
      announcedCapital: 0,
      authorizedTif: 0,
      federalProgram: 0,
      creditCapital: 0,
      publishedStateAppropriation,
      recordCount: 4,
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
        rank: 5,
        totalCAs: 77,
        citywideMedianCA: 1,
        thisVsMedian: 1,
        citywideTotal: 3_000_000,
        share: 1,
        foundationDollars: 0,
        foundationShare: 0,
      },
    };
  }

  beforeEach(() => {
    mockState.mockReset().mockResolvedValue({ configured: true, hasSession: true });
    mockLoadCommunityInvestment.mockReset().mockReturnValue(FIXTURE_INVESTMENT);
    mockLoadInvestmentAnalysis.mockReset();
  });

  it("shows EXACTLY this community's own sited appropriation subset — never the citywide meta figure", async () => {
    mockLoadInvestmentAnalysis.mockReturnValue(fixtureAnalysis(COMMUNITY_SITED_APPROPRIATION));
    const el = await Page({
      params: Promise.resolve({ area: "South Shore" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(el as ReactElement);
    // formatCompactDollars rounds the K-bucket to the nearest whole thousand.
    expect(html).toContain("$9K");
    expect(html).not.toContain("715,300,000");
    expect(html).not.toContain("$715.3M");
  });

  it("the disbursement card never implies the citywide recovery total belongs to this community", async () => {
    mockLoadInvestmentAnalysis.mockReturnValue(fixtureAnalysis(COMMUNITY_SITED_APPROPRIATION));
    const el = await Page({
      params: Promise.resolve({ area: "South Shore" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(el as ReactElement);
    expect(html).toContain("Not shown on this page");
    expect(html).not.toContain("923,400,000");
    expect(html).not.toContain("$923.4M");
    // The print brief's own missing-data warning must carry the same
    // citywide-scoped framing, not the old false absolute claim.
    expect(html).toContain("closed recovery-program files report a disbursed total citywide");
  });
});
