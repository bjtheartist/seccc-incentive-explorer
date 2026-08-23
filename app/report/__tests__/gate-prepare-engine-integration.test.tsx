// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}));
vi.mock("@/components/concierge/SiteConciergeProvider", () => ({
  ConciergePageContextBridge: () => <div data-testid="stub-concierge-bridge" />,
}));
vi.mock("@/components/report/RefineValuePanel", () => ({ RefineValuePanel: () => <div /> }));
// `PersonaChips` is DELIBERATELY ABSENT from this mock list (gate review
// follow-up, ITEM A) — it is the one thing the new persona-propagation
// test below needs real: it's the live report's own "Viewing As" row, the
// only place that renders the persona the gate committed via
// `aria-pressed`, independent of `ReportEmailGate`'s own (differently
// labeled) persona intake chips.
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
// Re-stubbed in `beforeEach`, not once at module scope: this file's own
// `afterEach` calls `vi.unstubAllGlobals()` (needed to reset the `fetch`
// stub each test installs) — with only ONE test in this file that never
// mattered, but a stub installed here only once would be silently gone
// for every test after the first now that there's more than one.
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
});
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
  // Gate review follow-up round 1, MAJOR-1: `resolveInitialPersona`/
  // `personaFromSearch` (lib/personas.ts) read the REAL `window.location.search`
  // directly, never `useSearchParams()` — both the gate (ReportEmailGate.tsx)
  // and the live view's framed-link notice (app/report/page.tsx) need it to
  // actually see a `?persona=` param. Kept in sync with the mocked router's
  // search string so both surfaces agree, the same way they do in production
  // (one real URL feeds both).
  window.history.pushState({}, "", `/report?${search}`);
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
  // The persona-propagation test below (ITEM A) reads
  // `resolveInitialPersona`'s sessionStorage fallback (lib/personas.ts) at
  // mount — jsdom's `sessionStorage` is NOT reset between tests in the
  // same file on its own, so a persona `commitPersonaSelection` wrote in
  // an earlier test (real ReportEmailGate, real storePersona call) would
  // otherwise leak into the next test's initial persona and desync it
  // from "All", the value every test in this file actually expects to
  // start from.
  window.sessionStorage.clear();
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

describe("gate persona propagates to the live report view (gate review follow-up, ITEM A — real bug Billy hit live)", () => {
  it("completing the gate as Business owner + a goal makes the live report's persona lens active immediately, without a reload", async () => {
    const { calls } = await renderReportRouteForSearch(
      "instant=true&addr=100+E+Test+St&lat=41.75&lon=-87.6",
    );

    const gate = await screen.findByTestId("report-email-gate", {}, { timeout: 15_000 });
    expect(gate).toBeTruthy();

    // Sanity, not the fix under test: BEFORE the gate resolves, the live
    // report's own "Viewing As" row (real `PersonaChips`, un-mocked in
    // this file — see the mock list above) is still on the untouched
    // default persona ("All"). This makes the assertion below a real
    // before/after transition, not a coincidental pre-existing pass.
    const allChipBefore = await screen.findByRole(
      "button",
      { name: "All" },
      { timeout: 15_000 },
    );
    expect(allChipBefore.getAttribute("aria-pressed")).toBe("true");

    // Complete the gate as Business owner + a goal — the exact repro
    // Billy hit live.
    const businessOwnerChip = await screen.findByRole(
      "button",
      { name: "Business owner" },
      { timeout: 15_000 },
    );
    fireEvent.click(businessOwnerChip);
    const expandChip = await screen.findByRole(
      "button",
      { name: "Expand or buy equipment" },
      { timeout: 15_000 },
    );
    fireEvent.click(expandChip);
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

    // The gate closes (`revealedReportKey` now matches) and the SAME,
    // already-mounted `ReportDisplay` instance — never remounted, never a
    // page reload — must now render the persona lens the visitor just
    // picked. `report.metadata` here carries no industry/goal signal that
    // would infer anything other than "growing" for a plain
    // reportType="site-incentives" report (see
    // lib/persona-inference.ts's final fallback), and "growing" is one of
    // the two PersonaIds the gate's single "Business owner" chip covers
    // (lib/gate-persona-groups.ts) — this is BOTH the inferred AND the
    // explicitly-tapped value, so a regression back to the pre-fix
    // behavior (gate persona never reaching the live view;
    // `guidepostPartForSection` returns null for `DEFAULT_PERSONA`, i.e.
    // "All") is unambiguous: "All" would still show pressed instead.
    const growingChip = await screen.findByRole(
      "button",
      { name: "Growing / property owner" },
      { timeout: 15_000 },
    );
    expect(growingChip.getAttribute("aria-pressed")).toBe("true");
    const allChipAfter = screen.getByRole("button", { name: "All" });
    expect(allChipAfter.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("gate persona seeds from a sender-framed ?persona= link (gate review follow-up round 1, MAJOR-1)", () => {
  it("a framed ?persona=developer link left UNTOUCHED in the gate propagates Developer, not the intake inference — live view + notice both stay Developer", async () => {
    const { calls } = await renderReportRouteForSearch(
      "instant=true&addr=100+E+Test+St&lat=41.75&lon=-87.6&persona=developer",
    );

    const gate = await screen.findByTestId("report-email-gate", {}, { timeout: 15_000 });
    expect(gate).toBeTruthy();

    // The gate's OWN persona row (GATE_PERSONA_CHIPS — a different label
    // set than the live view's PERSONA_CHIPS) must already show the
    // sender's framed lens pre-selected, before the visitor touches
    // anything — this is the actual MAJOR-1 fix (ReportEmailGate.tsx's
    // `persona` seed), not just its downstream effect.
    const gateDeveloperChip = await screen.findByRole(
      "button",
      { name: "Developer" },
      { timeout: 15_000 },
    );
    expect(gateDeveloperChip.getAttribute("aria-pressed")).toBe("true");

    // Left untouched: pick a goal, click View. Never tap a persona chip.
    const expandChip = await screen.findByRole(
      "button",
      { name: "Expand or buy equipment" },
      { timeout: 15_000 },
    );
    fireEvent.click(expandChip);
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

    // Live view: "Developer or investor" (PERSONA_CHIPS' label for the
    // SAME "developer" PersonaId) must be pressed — not whatever
    // `inferPersonaFromIntake` would have inferred from this signal-free
    // report ("growing", per lib/persona-inference.ts's final fallback).
    // Before the MAJOR-1 fix this was exactly the false-claim bug: the
    // gate silently overwrote the sender's framed lens with its own
    // inference the moment an untouched row propagated.
    const developerChip = await screen.findByRole(
      "button",
      { name: "Developer or investor" },
      { timeout: 15_000 },
    );
    expect(developerChip.getAttribute("aria-pressed")).toBe("true");
    const growingChipAfter = screen.getByRole("button", { name: "Growing / property owner" });
    expect(growingChipAfter.getAttribute("aria-pressed")).toBe("false");

    // The framed-link notice's claim is now true again: the visitor IS
    // viewing the lens the link was shared with.
    const notice = await screen.findByTestId("framed-persona-notice", {}, { timeout: 15_000 });
    expect(notice.textContent).toContain("Viewing as");
    expect(notice.textContent).toContain("Developer or investor");
    expect(notice.textContent).toContain("the lens this link was shared with");
  });

  it("a framed ?persona=developer link where the visitor taps a DIFFERENT gate chip propagates the visitor's choice, and the notice keeps main's existing (no-divergence-check) semantics", async () => {
    const { calls } = await renderReportRouteForSearch(
      "instant=true&addr=100+E+Test+St&lat=41.75&lon=-87.6&persona=developer",
    );

    const gate = await screen.findByTestId("report-email-gate", {}, { timeout: 15_000 });
    expect(gate).toBeTruthy();

    // Confirm the framed pre-selection first (same as the untouched test),
    // then actively correct it.
    const gateDeveloperChip = await screen.findByRole(
      "button",
      { name: "Developer" },
      { timeout: 15_000 },
    );
    expect(gateDeveloperChip.getAttribute("aria-pressed")).toBe("true");
    const gateSupportingChip = await screen.findByRole(
      "button",
      { name: "Supporting businesses" },
      { timeout: 15_000 },
    );
    fireEvent.click(gateSupportingChip);
    expect(gateSupportingChip.getAttribute("aria-pressed")).toBe("true");

    const expandChip = await screen.findByRole(
      "button",
      { name: "Expand or buy equipment" },
      { timeout: 15_000 },
    );
    fireEvent.click(expandChip);
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

    // The visitor's ACTUAL choice propagates — "Supporting local
    // businesses" pressed, not the framed "Developer or investor".
    const supportingChip = await screen.findByRole(
      "button",
      { name: "Supporting local businesses" },
      { timeout: 15_000 },
    );
    expect(supportingChip.getAttribute("aria-pressed")).toBe("true");
    const developerChipAfter = screen.getByRole("button", { name: "Developer or investor" });
    expect(developerChipAfter.getAttribute("aria-pressed")).toBe("false");

    // The notice's condition on main (verified via
    // lib/__tests__/shared-link-recipient.test.ts's fork-parity source
    // check: `isFramedPersonaLink && persona !== DEFAULT_PERSONA`, with NO
    // check that `persona` still equals the framed value) has no
    // divergence handling at all — ruling: match that, invent nothing. The
    // notice still renders here, now describing the visitor's OWN choice
    // rather than hiding or rewording itself, exactly as it already does
    // on main whenever a reader changes the lens on an ordinary framed
    // link (e.g. the ungated Workspace fork).
    const notice = await screen.findByTestId("framed-persona-notice", {}, { timeout: 15_000 });
    expect(notice.textContent).toContain("Supporting local businesses");
  });
});
