import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 20_000 });

/**
 * review6 S13 (HIGH): "apply the strict coordinate predicate to BOTH
 * instant=true and refine=true; fix the internal inconsistency — (0,0)
 * passes the validator but fails truthiness init ... TEST: exercise the
 * REAL page composition (not a test-local mirror) for missing/partial/
 * malformed/suffix-garbage/out-of-range/(0,0) under both params."
 *
 * lib/__tests__/instant-report-coords.test.ts already proves the pure
 * helpers (`isValidInstantCoordinatePair`, `parseInstantCoordinateParam`,
 * `resolveInstantWizardCoordinateSeed`) are individually correct, and — via
 * `computeInstantMode`/`computeRefineEntry` — that page.tsx's own
 * COMPOSITION of those helpers is correct. Both of those are still
 * "mirrors": hand-written functions in the test file that reproduce
 * page.tsx's logic rather than calling page.tsx itself. This file is the
 * literal "not a test-local mirror" half of the directive: it renders the
 * REAL, unmodified `app/report/page.tsx` default export, with REAL
 * `useSearchParams()` values and REAL (unmocked) `useState` initializers —
 * no seeded-array technique — for a representative URL per malformed
 * class, under both `instant=true` and `refine=true`, and asserts on the
 * actual rendered output.
 *
 * WHY THIS TECHNIQUE DIFFERS FROM report-page-live-renderer.test.tsx:
 * that file intentionally REPLACES every `useState` call with a seeded,
 * pre-computed value (to force a fully-populated `report` into view
 * without running the effect chain) — which necessarily bypasses the real
 * `wizardState`/`isRefineEntry`/`currentStepIndex` initializer LOGIC this
 * finding is about. This file does the opposite: `react` is never mocked,
 * so every `useState(() => ...)` initializer in `ReportWizardPage` runs
 * for real, off REAL `searchParams`. `report` naturally stays `null` (no
 * effects run without jsdom — same constraint that file documents), so
 * the component always renders its wizard-step branch or its
 * instant-loading-spinner branch, both reachable in a single synchronous
 * `renderToStaticMarkup` pass with no fetch/effect dependency.
 *
 * WHAT THIS PROVES, PER MALFORMED CLASS, FOR BOTH instant=true AND
 * refine=true:
 *   - instant=true: the "Generating Location Snapshot" spinner (gated on
 *     `instantLoading = useState(isInstantMode)`) never appears for an
 *     invalid pair — the real, page-level "never hang" guarantee.
 *   - refine=true: `currentStepIndex` (`useState(() => isRefineEntry ?
 *     <si-industry index> : 0)`) never skips ahead to the si-industry step
 *     for an invalid pair — proving `isRefineEntry` itself now applies the
 *     full strict predicate, not just a `!= null` check (the literal S13
 *     regression: `?refine=true&lat=999&lon=999` used to skip ahead with
 *     an unvalidated coordinate).
 *   - (0, 0) specifically, under refine=true with NO `addr` param: proves
 *     the OTHER half of the finding (the truthiness-vs-null-check
 *     inconsistency) in a way that's actually DOM-observable — see that
 *     test's own comment for the exact mechanics of why this case
 *     discriminates the fixed code from the pre-fix code.
 */

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
}));

// `ReportTypeStep` renders `motion.button`s; the wizard progress/step
// transition wrapper renders `motion.div`s. Both need a real DOM element
// stand-in (stripped of framer-motion-only props) for `renderToStaticMarkup`
// to produce anything — `report-page-live-renderer.test.tsx` only ever
// mocks `motion.div` because its harness never actually reaches these wizard
// step components (report is always pre-seeded there).
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

/**
 * Renders the REAL `app/report/page.tsx` default export for a given raw
 * query string, with `useSearchParams()` mocked to exactly that string —
 * `react` itself is NEVER mocked, so every `useState` initializer in the
 * component runs for real off these real search params.
 */
async function renderReportRouteForSearch(search: string): Promise<string> {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  }));
  const { default: ReportPageWrapper } = await import("../page");
  const html = renderToStaticMarkup(<ReportPageWrapper />);
  vi.doUnmock("next/navigation");
  vi.resetModules();
  return html;
}

const SPINNER_TEXT = "Generating Location Snapshot";
const SI_INDUSTRY_TITLE = "What’s your industry?"; // lib/report-wizard-config.ts "si-industry"

const MALFORMED_QUERY_CLASSES: { label: string; qs: string }[] = [
  { label: "missing (no lat/lon at all)", qs: "" },
  { label: "partial (lat only)", qs: "lat=41.75" },
  { label: "partial (lon only)", qs: "lon=-87.6" },
  { label: "malformed (non-numeric lat)", qs: "lat=abc&lon=-87.6" },
  { label: "malformed (non-numeric lon)", qs: "lat=41.75&lon=xyz" },
  // review6 S13's own named class: parseFloat used to accept the leading
  // numeric prefix and silently discard the rest.
  { label: "suffix-garbage lat", qs: "lat=41.75garbage&lon=-87.6" },
  { label: "suffix-garbage lon", qs: "lat=41.75&lon=-87.6; DROP TABLE" },
  { label: "out-of-range lat", qs: "lat=999&lon=-87.6" },
  { label: "out-of-range lon", qs: "lat=41.75&lon=999" },
  { label: "out-of-range both", qs: "lat=500&lon=-500" },
];

describe("live page composition — instant=true never engages (no spinner, no hang) for any malformed coordinate class (review6 S13)", () => {
  for (const { label, qs } of MALFORMED_QUERY_CLASSES) {
    it(`${label}: no "${SPINNER_TEXT}" spinner`, async () => {
      const html = await renderReportRouteForSearch(`instant=true&addr=100+E+Test+St&${qs}`);
      expect(html).not.toContain(SPINNER_TEXT);
    });
  }

  it("a genuinely valid pair WITH instant=true DOES show the spinner (sanity control — proves the assertion above is meaningful, not vacuous)", async () => {
    const html = await renderReportRouteForSearch("instant=true&addr=100+E+Test+St&lat=41.75&lon=-87.6");
    expect(html).toContain(SPINNER_TEXT);
  });

  it("(0, 0) WITH instant=true DOES show the spinner — isInstantMode itself correctly treats (0,0) as valid (isValidInstantCoordinatePair's own documented behavior)", async () => {
    const html = await renderReportRouteForSearch("instant=true&addr=100+E+Test+St&lat=0&lon=0");
    expect(html).toContain(SPINNER_TEXT);
  });
});

describe("live page composition — refine=true never skips ahead to si-industry for any malformed coordinate class (review6 S13)", () => {
  for (const { label, qs } of MALFORMED_QUERY_CLASSES) {
    it(`${label}: wizard stays on the report-type step, never jumps to "${SI_INDUSTRY_TITLE}"`, async () => {
      const html = await renderReportRouteForSearch(`refine=true&addr=100+E+Test+St&${qs}`);
      expect(html).not.toContain(SI_INDUSTRY_TITLE);
    });
  }

  it("a genuinely valid pair WITH refine=true DOES skip ahead to si-industry (sanity control)", async () => {
    const html = await renderReportRouteForSearch("refine=true&addr=100+E+Test+St&lat=41.75&lon=-87.6");
    expect(html).toContain(SI_INDUSTRY_TITLE);
  });

  it("review6 S13's literal named regression: lat=999&lon=999 (both non-null, so the OLD `!= null`-only check accepted this pair) no longer engages refine entry", async () => {
    const html = await renderReportRouteForSearch("refine=true&addr=100+E+Test+St&lat=999&lon=999");
    expect(html).not.toContain(SI_INDUSTRY_TITLE);
  });

  it("(0, 0) WITH refine=true and NO addr param: skips ahead to si-industry WITHOUT crashing — the discriminating proof for the truthiness-vs-null-check fix", async () => {
    // Why this specific case discriminates old (buggy) code from the fix:
    // `isRefineEntry` (gated only by `isValidInstantCoordinatePair`, which
    // always correctly accepted (0,0)) would have been `true` under BOTH
    // the old and new code — so `currentStepIndex`'s own initializer
    // (`isRefineEntry ? <si-industry index> : 0`) would try to jump to the
    // si-industry step's index EITHER WAY. But the OLD wizardState
    // initializer's `if (isRefineEntry && instantLat && instantLon)` — a
    // truthy check — evaluates `0 && 0` as falsy and SKIPS setting
    // `wizardState.reportType`. With no `addr` param, every later branch
    // also fails (no urlAddress fallback to paper over it), so wizardState
    // falls all the way through to bare `INITIAL_WIZARD_STATE`
    // (`reportType: null`). `steps` (a `useMemo` keyed off
    // `wizardState.reportType`) then returns the single-step
    // report-type-selection array — but `currentStepIndex` is already
    // pinned to the si-industry index from a 6-step site-incentives array.
    // `steps[currentStepIndex]` is `undefined`, and `currentStep.title`
    // throws, crashing the render. The fix (the shared
    // `resolveInstantWizardCoordinateSeed`, `!= null` not `&&`) sets
    // `reportType: "site-incentives"` correctly for (0,0), so `steps`
    // and `currentStepIndex` stay in sync and this renders cleanly.
    const html = await renderReportRouteForSearch("refine=true&lat=0&lon=0");
    expect(html).toContain(SI_INDUSTRY_TITLE);
  });

  it("instant=true and refine=true both present, instant valid: refine is ignored, no error, spinner shows (instant takes precedence per requestedRefineMode's own `!isInstantMode` gate)", async () => {
    const html = await renderReportRouteForSearch(
      "instant=true&refine=true&addr=100+E+Test+St&lat=41.75&lon=-87.6",
    );
    expect(html).toContain(SPINNER_TEXT);
    expect(html).not.toContain(SI_INDUSTRY_TITLE);
  });
});
