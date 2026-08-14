// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * review7 S18 (HIGH): S13 fixed `wizardState.lat`/`.lon` seeding so a
 * validated (0, 0) pair is no longer dropped by a truthy check — but
 * every DOWNSTREAM effect in `ReportWizardPage` (zone lookup, census/
 * parcel, site signals, stacking/local-business-support, and the
 * instant/share auto-generation gates) independently re-checked
 * `wizardState.lat && wizardState.lon`, the SAME truthy anti-pattern,
 * one level down. For (0, 0): the zone effect's `if (!wizardState.lat
 * || !wizardState.lon)` treated it as "no coordinates," cleared `zones`
 * to `null`, and never fetched — so the instant-mode generation effect's
 * `if (!zones) return;` waited on a value that could never become
 * non-null again. "Generating Location Snapshot" spun forever, with no
 * error and no way out.
 *
 * Unlike `instant-refine-coordinate-live-composition.test.tsx` (S13),
 * which only needs the FIRST synchronous render pass (no jsdom, no
 * effects), this fix is entirely about EFFECTS actually firing and
 * resolving — so this file uses jsdom + React Testing Library
 * (`render`/`waitFor`), the technique already established elsewhere in
 * this codebase (e.g. `components/vacancy/__tests__/SiteShortlistResults.test.tsx`),
 * with every network dependency mocked so the whole effect chain can
 * settle deterministically without a real network.
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

// Non-fetch data dependencies mocked at the module level so the effect
// chain resolves deterministically without a real network stack for
// these specific calls (site-signals/transport-access/zoning-lookup are
// not plain `fetch` wrappers this file can intercept via the global
// fetch mock below).
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

// The dozen-plus child components ReportDisplay mounts once `report` is
// set — stubbed to hookless placeholders, same rationale and same list
// as report-page-live-renderer.test.tsx's own established precedent (a
// production report shouldn't need this test to also prove out every
// child component's own rendering).
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
vi.mock("@/components/report/ReportEmailGate", () => ({ ReportEmailGate: () => <div /> }));
// review8 S23 (MEDIUM): the stub now RENDERS the lat/lon (and address)
// props it actually received, as data-* attributes, instead of
// discarding them — needed to assert the bridge's own props stay `0`
// for a validated (0, 0) pair, not silently converted to `undefined` by
// a truthy fallback. `ConciergePageContextBridge` itself only acts via
// a `useEffect` calling context `setOverride` (no visible DOM otherwise,
// and the real `ConciergeOverrideContext` is module-private/unexported,
// so it can't be observed by wrapping the render in a matching
// Provider) — capturing the props at the mock boundary is the only way
// to assert on them from outside this module.
vi.mock("@/components/concierge/SiteConciergeProvider", () => ({
  ConciergePageContextBridge: (props: { lat?: number; lon?: number; address?: string }) => (
    <div
      data-testid="stub-concierge-bridge"
      data-lat={String(props.lat)}
      data-lon={String(props.lon)}
      data-address={String(props.address)}
    />
  ),
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

const SPINNER_TEXT = "Generating Location Snapshot";

const MINIMAL_REPORT = {
  title: "Eligible Incentive Programs",
  subtitle: "Location review",
  reportType: "site-incentives",
  generatedAt: "2026-08-14T00:00:00.000Z",
  summary: "Review the published criteria for programs near this location.",
  verdict: { signal: "neutral", headline: "Review published criteria", subheadline: "", topReasons: [] },
  sections: [],
  recommendedActions: [],
  actionRoadmap: [],
  metadata: { address: "0,0 Test Point", lat: 0, lon: 0 },
};

/** Records every fetched URL and routes a handful of known endpoints to
 *  deterministic responses; anything else gets a generic empty 200 so
 *  every `.then`/`.catch`/`.finally` in the effect chain settles instead
 *  of hanging on an unresolved promise. */
function installFetchMock(): { calls: string[] } {
  const calls: string[] = [];
  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(`${init?.method ?? "GET"} ${url}`);

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
      return new Response(JSON.stringify(MINIMAL_REPORT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Generic catch-all: every other effect (census/parcel/representatives/
    // mobility-access/stacking/assets/local-business-support/stats/geocode/
    // community anchors/tif-finance) just needs its promise to SETTLE —
    // an empty object is a harmless, gracefully-degraded response for all
    // of them (each has its own `.catch`/`if (data)` guard).
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

describe("instant=true with (0, 0): the full effect chain resolves — no infinite spinner (review7 S18)", () => {
  it("calls the v2 zone route with lat=0&lon=0", async () => {
    const { calls } = await renderReportRouteForSearch(
      "instant=true&addr=Null+Island+Test&lat=0&lon=0",
    );
    await waitFor(() => {
      expect(calls.some((c) => c.includes("/api/zones/check/v2") && c.includes("lat=0") && c.includes("lon=0"))).toBe(true);
    });
  });

  it("calls /api/report/generate (POST) — the generation effect actually fires, not stuck waiting on a null zones value", async () => {
    const { calls } = await renderReportRouteForSearch(
      "instant=true&addr=Null+Island+Test&lat=0&lon=0",
    );
    await waitFor(
      () => {
        expect(calls.some((c) => c.startsWith("POST") && c.includes("/api/report/generate"))).toBe(true);
      },
      { timeout: 10_000 },
    );
  });

  it("exits the spinner — 'Generating Location Snapshot' is NOT stuck on screen once the report resolves", async () => {
    await renderReportRouteForSearch("instant=true&addr=Null+Island+Test&lat=0&lon=0");
    // Spinner should be visible immediately (isInstantMode true, instantLoading true).
    expect(screen.getByText(SPINNER_TEXT)).toBeTruthy();
    // ...and must disappear once the effect chain resolves and the report is set.
    await waitFor(
      () => {
        expect(screen.queryByText(SPINNER_TEXT)).toBeNull();
      },
      { timeout: 10_000 },
    );
  });

  it("CONTROL: a genuinely valid non-zero pair also exits the spinner (proves the assertion above is meaningful for the ordinary case too)", async () => {
    await renderReportRouteForSearch("instant=true&addr=100+E+Test+St&lat=41.75&lon=-87.6");
    expect(screen.getByText(SPINNER_TEXT)).toBeTruthy();
    await waitFor(
      () => {
        expect(screen.queryByText(SPINNER_TEXT)).toBeNull();
      },
      { timeout: 10_000 },
    );
  });
});

/**
 * review8 S23 (MEDIUM): S18 fixed every DOWNSTREAM effect's truthy
 * coordinate check, but missed the `ConciergePageContextBridge` props
 * at the bottom of the plain wizard-UI render — `lat={wizardState.lat
 * || undefined}` / `lon={wizardState.lon || undefined}` silently
 * converts a validated `(0, 0)` pair to `undefined`, disabling
 * location-aware concierge checks for exactly the coordinate this whole
 * finding chain exists to make work. Reached via the `urlAddress`-only
 * wizard branch (no `instant=true`/`refine=true`) — the one branch S13
 * explicitly left unvalidated as out of scope (it sets `lat`/`lon`
 * directly, no truthy gate of its own), which is exactly why (0, 0)
 * flows into `wizardState` correctly here and this test can isolate
 * the bridge-prop bug specifically, independent of any generation gate.
 */
describe("the wizard-UI ConciergePageContextBridge keeps (0, 0), not undefined (review8 S23)", () => {
  it("both bridge coordinates remain the number 0 — not the string 'undefined' a truthy fallback would produce", async () => {
    await renderReportRouteForSearch("addr=Null+Island+Test&lat=0&lon=0");
    const bridge = await waitFor(() => screen.getByTestId("stub-concierge-bridge"));
    expect(bridge.getAttribute("data-lat")).toBe("0");
    expect(bridge.getAttribute("data-lon")).toBe("0");
    expect(bridge.getAttribute("data-address")).toBe("Null Island Test");
  });

  it("CONTROL: a genuinely valid non-zero pair also passes through correctly (proves the assertion above is meaningful, not vacuous)", async () => {
    await renderReportRouteForSearch("addr=100+E+Test+St&lat=41.75&lon=-87.6");
    const bridge = await waitFor(() => screen.getByTestId("stub-concierge-bridge"));
    expect(bridge.getAttribute("data-lat")).toBe("41.75");
    expect(bridge.getAttribute("data-lon")).toBe("-87.6");
  });

  it("no coordinates at all: both bridge props stay undefined (the correct, non-buggy case for a genuinely missing pair)", async () => {
    await renderReportRouteForSearch("addr=Somewhere");
    const bridge = await waitFor(() => screen.getByTestId("stub-concierge-bridge"));
    expect(bridge.getAttribute("data-lat")).toBe("undefined");
    expect(bridge.getAttribute("data-lon")).toBe("undefined");
  });
});

/**
 * review8 S23 (MEDIUM): "the new [S18] suite also exercises only
 * instant mode, so reverting the separate share-mode gate stays green."
 * S18 found and fixed an IDENTICAL, independently-copied truthy-check
 * bug in the share-mode auto-generation effect (never explicitly named
 * by S18's own finding text, discovered while sweeping the file for the
 * same pattern) — but never added a share-mode test, so a future
 * regression in THAT gate specifically would have gone undetected by
 * the existing suite. A share-mode link uses the `wv=2`/`rt=`/`lat=`/
 * `lon=` query scheme (`lib/url-state.ts`'s `decodeWizardState`), not
 * `instant=true`/`refine=true`.
 */
describe("share mode (wv=2) with (0, 0): the generation gate fires — the same fix S18 made for instant mode, now covered for share mode too (review8 S23)", () => {
  it("calls /api/report/generate (POST) for a share-mode (0, 0) link", async () => {
    const { calls } = await renderReportRouteForSearch(
      "wv=2&rt=si&addr=Null+Island+Test&lat=0&lon=0",
    );
    await waitFor(
      () => {
        expect(calls.some((c) => c.startsWith("POST") && c.includes("/api/report/generate"))).toBe(true);
      },
      { timeout: 10_000 },
    );
  });

  it("also calls the v2 zone route with lat=0&lon=0 for a share-mode link", async () => {
    const { calls } = await renderReportRouteForSearch(
      "wv=2&rt=si&addr=Null+Island+Test&lat=0&lon=0",
    );
    await waitFor(() => {
      expect(calls.some((c) => c.includes("/api/zones/check/v2") && c.includes("lat=0") && c.includes("lon=0"))).toBe(true);
    });
  });
});
