// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Gate review round 3, MAJOR finding R3-A (the THIRD round flagging this
 * exact gap) — the ruling's PRIMARY fix, preferred over the AST fence in
 * gate-prepare-call-site-fence.test.ts: "execute the real handler path."
 *
 * Every prior round's test mocked `onPrepareReport` as a `vi.fn()` prop on
 * `ReportEmailGate`, so `app/report/page.tsx`'s real
 * `handlePrepareGatedReport` closure never actually ran in any test in
 * this repo — the reviewer proved this by swapping its real
 * `resolveGatePrepareGoals` call for an inline, capped
 * `selectedProjectGoals` + JSON-compare reimplementation and watching
 * 3822 tests stay green.
 *
 * This file renders the REAL `ReportPageWrapper` (the actual default
 * export of app/report/page.tsx — same technique already established by
 * instant-mode-zero-zero-effect-composition.test.tsx), leaves
 * `ReportEmailGate` UNSTUBBED so its real buttons render and its real
 * `onClick` handlers fire, clicks through a real gate interaction, and
 * inspects the ACTUAL outgoing `POST /api/report/generate` request body
 * — the same body `lib/report-engine.ts`'s server-side handler reads via
 * `selectedProjectGoals(state)`. If `handlePrepareGatedReport`'s call
 * site regresses to the capped wizard function, this test's captured
 * request body will be missing ids and the assertion fails.
 */

vi.setConfig({ testTimeout: 20_000 });

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
}));

function stripMotionProps<T extends Record<string, unknown>>(rest: T) {
  const { initial: _i, animate: _a, exit: _e, transition: _t, custom: _c, variants: _v, whileHover: _wh, whileTap: _wt, ...clean } = rest as Record<string, unknown>;
  return clean;
}

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <div {...stripMotionProps(rest)}>{children as React.ReactNode}</div>
    ),
    button: ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <button {...stripMotionProps(rest)}>{children as React.ReactNode}</button>
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/site-signals", () => ({
  getSiteSignals: vi.fn(async () => null),
}));
vi.mock("@/lib/transport-access", () => ({
  getTransportAccess: vi.fn(async () => null),
}));
vi.mock("@/lib/zoning-lookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/zoning-lookup")>();
  return {
    ...actual,
    fetchZoningLookup: vi.fn(async () => ({
      status: "unavailable" as const,
      zoneClass: null,
      zoneType: null,
      source: null,
      message: "test stub",
    })),
  };
});

// Same stub list as instant-mode-zero-zero-effect-composition.test.tsx —
// the dozen-plus child components ReportDisplay mounts once `report` is
// set, none of which this test needs real. `ReportEmailGate` is
// DELIBERATELY ABSENT from this list — it is the one thing this file
// needs real.
vi.mock("@/components/ui/accordion", () => ({
  Accordion: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AccordionTrigger: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AccordionContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/zoning/ZoningReviewQuestions", () => ({
  ZoningReviewQuestions: () => <div data-testid="stub-zoning-review-questions" />,
}));
vi.mock("@/components/report/ReportZoningMap", () => ({ default: () => <div /> }));
vi.mock("@/components/report/SiteActivityCard", () => ({ SiteActivityCard: () => <div /> }));
vi.mock("@/components/report/CrossLinkBanner", () => ({
  InlineCrossLinkBanner: () => <div />,
  StickyCrossLinkBanner: () => <div />,
}));
vi.mock("@/components/concierge/SiteConciergeProvider", () => ({
  ConciergePageContextBridge: () => <div data-testid="stub-concierge-bridge" />,
}));
vi.mock("@/components/report/RefineValuePanel", () => ({ RefineValuePanel: () => <div /> }));
vi.mock("@/components/report/PersonaChips", () => ({ PersonaChips: () => <div /> }));
vi.mock("@/components/report/GroupedReportDetail", () => ({ GroupedReportDetail: () => <div /> }));
vi.mock("@/components/incentive-preparation/StartPreparationPacketButton", () => ({
  StartPreparationPacketButton: () => <div />,
}));
vi.mock("@/components/report/AdminOwnershipPanel", () => ({ AdminOwnershipPanel: () => <div /> }));
vi.mock("@/components/report/CapitalPartnerHandoff", () => ({ CapitalPartnerHandoff: () => <div /> }));
vi.mock("@/components/workspace/SaveReportModal", () => ({ SaveReportModal: () => <div /> }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// jsdom implements neither of these; the fully-stubbed sibling file
// (instant-mode-zero-zero-effect-composition.test.tsx) never mounts the
// real components that reach them. Rendering the REAL ReportEmailGate +
// ReportDisplay does: an IntersectionObserver-driven visibility effect,
// and window.scrollTo() from handleGatedReportReady after the gate
// resolves. Both are cosmetic/observational in production and irrelevant
// to what this test verifies (the outgoing request body), but an
// unstubbed IntersectionObserver reference throws a real
// ReferenceError that fails the whole file even though the test's own
// assertions pass.
class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
if (!window.scrollTo || !vi.isMockFunction(window.scrollTo)) {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
}

const REPORT: Record<string, unknown> = {
  title: "Eligible Incentive Programs",
  subtitle: "Location review",
  reportType: "site-incentives",
  generatedAt: "2026-08-14T00:00:00.000Z",
  summary: "Review the published criteria for programs near this location.",
  verdict: { signal: "neutral", headline: "Review published criteria", subheadline: "", topReasons: [] },
  sections: [],
  recommendedActions: [],
  actionRoadmap: [],
  metadata: { address: "100 E Test St", lat: 41.75, lon: -87.6 },
};

interface CapturedCall {
  method: string;
  url: string;
  body: unknown;
}

/** Same shape as the established `installFetchMock` helper, extended to
 *  capture request BODIES for POST calls — this test needs to inspect
 *  what was actually SENT, not just that a call happened. */
function installFetchMock(): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method, url, body });

    if (url.includes("/api/zones/check/v2")) {
      return new Response(
        JSON.stringify({
          schemaVersion: 2,
          dataRevision: "test-revision",
          checkedAt: "2026-08-14T00:00:00.000Z",
          requestedLayers: [],
          layers: {},
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/api/report/generate")) {
      return new Response(JSON.stringify(REPORT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", mockFetch);
  return { calls };
}

async function renderReportRouteForSearch(search: string) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  }));
  const fetchMock = installFetchMock();
  const { default: ReportPageWrapper } = await import("../page");
  const view = render(<ReportPageWrapper />);
  return { view, calls: fetchMock.calls };
}

afterEach(() => {
  cleanup();
  vi.doUnmock("next/navigation");
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("real handlePrepareGatedReport execution (gate review round 3, R3-A — the primary fix)", () => {
  it("clicking through the REAL, unstubbed gate sends all 4 goal ids in the real /api/report/generate request body", async () => {
    const { calls } = await renderReportRouteForSearch(
      "instant=true&addr=100+E+Test+St&lat=41.75&lon=-87.6",
    );

    // `find*` queries (not a single synchronous `getBy*` right after an
    // earlier `waitFor` resolves) — CI runners can be meaningfully slower
    // than local dev machines, and the gate's own chip row can still be
    // settling a render pass after its outer `<dialog>` testid first
    // appears. Each lookup below retries on its own until found.
    const gate = await screen.findByTestId("report-email-gate", {}, { timeout: 15_000 });
    expect(gate).toBeTruthy();

    const expandChip = await screen.findByRole(
      "button",
      { name: "Expand or buy equipment" },
      { timeout: 15_000 },
    );
    fireEvent.click(expandChip);
    const mixedUseChip = await screen.findByRole(
      "button",
      { name: "Develop housing or mixed-use" },
      { timeout: 15_000 },
    );
    fireEvent.click(mixedUseChip);
    const viewButton = await screen.findByTestId(
      "report-email-gate-view",
      {},
      { timeout: 15_000 },
    );
    fireEvent.click(viewButton);

    await waitFor(
      () => {
        const generateCalls = calls.filter(
          (call) => call.method === "POST" && call.url.includes("/api/report/generate"),
        );
        expect(generateCalls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 15_000 },
    );

    const generateCalls = calls.filter(
      (call) => call.method === "POST" && call.url.includes("/api/report/generate"),
    );
    // The SECOND generate call is the gate's own prepare — the first is
    // the initial instant-mode report generation before the gate showed.
    const gatePrepareBody = generateCalls[1].body as {
      state?: { projectGoals?: string[] };
    };
    const sentGoals = gatePrepareBody.state?.projectGoals ?? [];
    expect(new Set(sentGoals)).toEqual(
      new Set(["expansion", "equipment", "mixed-use", "affordable-housing"]),
    );
    expect(sentGoals.length).toBe(4);
  });
});
