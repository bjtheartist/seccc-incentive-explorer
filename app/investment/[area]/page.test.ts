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

// R1 finding 4: the page now reads the TYPED loader so it can tell an
// unloadable export apart from a community with genuinely no records. The
// real copy constants are kept (importOriginal) so an assertion on the
// unavailability copy pins the shipped string, not a test-local duplicate.
vi.mock("@/lib/community-investment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/community-investment")>()),
  loadCommunityInvestment: vi.fn(),
  loadCommunityInvestmentResult: vi.fn(),
}));

vi.mock("@/lib/investment-analysis", () => ({
  loadInvestmentAnalysis: vi.fn(),
  loadMajorDevelopments: vi.fn(() => ({ count: 0, totalAnnounced: 0, developments: [] })),
  loadFlowRows: vi.fn(() => []),
}));

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, notFound: notFoundMock };
});

import * as gate from "@/app/investment/gate";
import { loadCommunityInvestment, loadCommunityInvestmentResult } from "@/lib/community-investment";
import { COMMUNITY_INVESTMENT_UNAVAILABLE_HEADING } from "@/lib/community-investment";
import { loadInvestmentAnalysis } from "@/lib/investment-analysis";
import type { CommunityInvestmentExport } from "@/lib/community-investment";
import type { CommunityInvestmentAnalysis } from "@/lib/investment-analysis";
import Page from "./page";

const mockState = vi.mocked(gate.getInvestmentAdminState);
const mockLoadCommunityInvestment = vi.mocked(loadCommunityInvestment);
const mockLoadCommunityInvestmentResult = vi.mocked(loadCommunityInvestmentResult);

/**
 * Keep the two loaders in lockstep so every pre-existing `mockLoadCommunityInvestment`
 * setup line still steers the page exactly as it did before the typed loader landed.
 * A test that wants the OUTAGE branch overrides `mockLoadCommunityInvestmentResult`
 * directly.
 */
function syncInvestmentLoaders(): void {
  mockLoadCommunityInvestmentResult.mockReset().mockImplementation(() => {
    const data = mockLoadCommunityInvestment();
    return data ? { ok: true, data } : { ok: false, reason: "export_missing" };
  });
}
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

type GateProps = { redirectTo?: string; hasAuthError?: boolean };

function renderElement(
  area = AREA,
  searchParams: Record<string, string> = {},
): Promise<ReactElement<GateProps>> {
  return Page({
    params: Promise.resolve({ area }),
    searchParams: Promise.resolve(searchParams),
  } as never) as Promise<ReactElement<GateProps>>;
}

/**
 * GATE branches for the interactive area page. Every case in the StatusCards
 * block below runs with the gate mocked to configured+session, so the two
 * refusal branches this page shares with its print sibling
 * (app/print/investment/[area]/page.test.ts) were never exercised here — a
 * regression that dropped either check would have rendered community
 * investment detail to the public with a green suite. Mirrors the print
 * sibling's gate tests.
 */
describe("/investment/[area] page — gate", () => {
  beforeEach(() => {
    mockState.mockReset();
    notFoundMock.mockClear();
  });

  it("renders the not-configured screen when the admin gate is unset", async () => {
    mockState.mockResolvedValue({ configured: false, hasSession: false });
    const el = await renderElement();
    expect(el.type).toBe(gate.InvestmentNotConfigured);
  });

  it("renders the password wall (no session) and never reaches the area detail", async () => {
    mockState.mockResolvedValue({ configured: true, hasSession: false });
    const el = await renderElement();
    expect(el.type).toBe(gate.InvestmentLoginForm);
    expect(el.props.redirectTo).toBe(`/investment/${AREA}`);
    expect(el.props.hasAuthError).toBe(false);
    // The gate returns before any community data is loaded.
    expect(mockLoadInvestmentAnalysis).not.toHaveBeenCalled();
    expect(mockLoadCommunityInvestment).not.toHaveBeenCalled();
  });

  it("passes an error flag through to the password wall", async () => {
    mockState.mockResolvedValue({ configured: true, hasSession: false });
    const el = await renderElement(AREA, { error: "1" });
    expect(el.type).toBe(gate.InvestmentLoginForm);
    expect(el.props.hasAuthError).toBe(true);
  });

  it("routes an unknown community-area slug to not-found, past the gate", async () => {
    mockState.mockResolvedValue({ configured: true, hasSession: true });
    mockLoadCommunityInvestment.mockReturnValue(FIXTURE_INVESTMENT);

    await expect(renderElement("Not A Community Area")).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledOnce();
    // A slug that resolves to no community area must never reach a data load.
    expect(mockLoadInvestmentAnalysis).not.toHaveBeenCalled();
  });
});

describe("/investment/[area] page — StatusCards scope (Sol gate blockers 2 + 5)", () => {
  beforeEach(() => {
    mockState.mockReset().mockResolvedValue({ configured: true, hasSession: true });
    mockLoadCommunityInvestment.mockReset().mockReturnValue(FIXTURE_INVESTMENT);
    syncInvestmentLoaders();
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

/**
 * R1 finding 4 — the false-claims class, /investment/[area].
 *
 * When the export could not be loaded, this page rendered "No grants, awards,
 * or development have been recorded in <area> since 2020 in this dataset."
 * That sentence is an authoritative negative finding about a real Chicago
 * neighbourhood, published from a file the app never read. Each test asserts
 * BOTH halves: the honest unavailability copy is PRESENT, and the absence
 * claim is ABSENT.
 */
describe("/investment/[area] — a dataset outage is never rendered as an absence", () => {
  const ABSENCE_CLAIM = "No grants, awards, or development have been recorded";

  beforeEach(() => {
    mockState.mockReset().mockResolvedValue({ configured: true, hasSession: true });
    mockLoadInvestmentAnalysis.mockReset();
    mockLoadCommunityInvestment.mockReset();
  });

  const failures = [
    "export_missing",
    "export_unreadable",
    "export_invalid_json",
    "export_invalid_shape",
  ] as const;

  for (const reason of failures) {
    it(`a ${reason} load renders the unavailability state, not the absence claim`, async () => {
      mockLoadCommunityInvestmentResult.mockReset().mockReturnValue({ ok: false, reason });
      // The analysis builder reads the same absent export, so it is null too —
      // which is exactly the shape that used to be indistinguishable.
      mockLoadInvestmentAnalysis.mockReturnValue(null);

      const html = await render();

      expect(html).toContain(COMMUNITY_INVESTMENT_UNAVAILABLE_HEADING);
      expect(html).toContain("could not be loaded");
      expect(html).not.toContain(ABSENCE_CLAIM);
    });
  }

  it("a LOADED dataset with no records for this community keeps the genuine absence claim", async () => {
    mockLoadCommunityInvestment.mockReturnValue(FIXTURE_INVESTMENT);
    syncInvestmentLoaders();
    mockLoadInvestmentAnalysis.mockReturnValue(null);

    const html = await render();

    expect(html).toContain(ABSENCE_CLAIM);
    expect(html).not.toContain(COMMUNITY_INVESTMENT_UNAVAILABLE_HEADING);
  });
});
