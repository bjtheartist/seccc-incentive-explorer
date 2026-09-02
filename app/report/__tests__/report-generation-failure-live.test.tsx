// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * R1 finding 1 — the infinite spinner, proven on the LIVE /report route.
 *
 * Every `generateReportRemote` call site in app/report/page.tsx caught its
 * error with `console.error` + `trackEvent` and nothing else. The instant-mode
 * one said so in a comment — "Stay on loading" — which is exactly what it did:
 * `instantLoading` was never cleared on the failure path, so a reader whose
 * report generation failed watched "Generating Location Snapshot" pulse
 * forever, with no statement that anything had gone wrong and nothing to click.
 *
 * The sibling instant-mode-zero-zero-effect-composition.test.tsx proves the
 * SUCCESS path leaves the spinner. This file proves the FAILURE path does too —
 * into an honest, retryable card rather than into an endless animation.
 *
 * Harness note: this mounts the real route through jsdom + RTL so the whole
 * effect chain actually runs, the same technique (and the same module mocks)
 * as that sibling file. Fewer child-component stubs are needed here because
 * `report` never becomes non-null on a failure, so `ReportDisplay` and its
 * dozen children never mount.
 */

vi.setConfig({ testTimeout: 20_000 });

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
}));

function stripMotionProps<T extends Record<string, unknown>>(rest: T) {
  const {
    initial: _i,
    animate: _a,
    exit: _e,
    transition: _t,
    custom: _c,
    variants: _v,
    whileHover: _wh,
    whileTap: _wt,
    ...clean
  } = rest as Record<string, unknown>;
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

vi.mock("@/lib/site-signals", () => ({ getSiteSignals: vi.fn(async () => null) }));
vi.mock("@/lib/transport-access", () => ({ getTransportAccess: vi.fn(async () => null) }));
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

const SPINNER_TEXT = "Generating Location Snapshot";
const CORRIDOR_SPINNER_TEXT = "Generating Corridor Intelligence";

/**
 * A shared-report link (`decodeWizardState` needs `wv`, and `rt=si` is the
 * short code for site-incentives) carrying a NEIGHBORHOOD rather than an
 * address, so `hasWizardCoords` is false and the share effect's coordinate
 * gates — zones, parcel, zoning key, local support, site signals, transport,
 * mobility — are all skipped. Generation is then the only thing left that can
 * fail, which is what this file is about.
 */
const SHARED_REPORT_SEARCH = "wv=1&rt=si&nbh=Chatham";

/**
 * Fails /api/report/generate with a 500 and settles everything else, so the
 * ONLY thing that goes wrong is the one call this finding is about.
 * `generateCalls` counts the attempts, which is how the retry is proven to be
 * a genuine re-run rather than a cosmetic state reset.
 */
function installFailingGenerateFetch(): { generateCalls: () => number } {
  let generateCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/report/generate")) {
        generateCalls += 1;
        return new Response(JSON.stringify({ error: "boom" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
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
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { generateCalls: () => generateCalls };
}

async function renderReportRouteForSearch(search: string) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(search),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  }));
  const probe = installFailingGenerateFetch();
  const { default: ReportPageWrapper } = await import("../page");
  render(<ReportPageWrapper />);
  return probe;
}

afterEach(() => {
  cleanup();
  vi.doUnmock("next/navigation");
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("instant mode: a failed generation exits the spinner into an honest retry card", () => {
  it("stops spinning and says the report was not generated", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderReportRouteForSearch("instant=true&addr=100+E+Test+St&lat=41.75&lon=-87.6");

    // The spinner is the correct FIRST state — the defect was that it was
    // also the last one.
    expect(screen.getByText(SPINNER_TEXT)).toBeTruthy();

    const card = await screen.findByTestId("report-generation-error", undefined, {
      timeout: 10_000,
    });

    expect(screen.queryByText(SPINNER_TEXT)).toBeNull();
    expect(card.textContent).toContain("We couldn't generate your report");
    expect(card.textContent).toContain("nothing you entered was lost");
    // Honest, and never dressed up as a finding about the address.
    expect(card.textContent).not.toMatch(/eligib|qualif|no programs|no incentives/i);
    // A way forward always exists.
    expect(screen.getByTestId("report-generation-retry")).toBeTruthy();
  });

  it("the retry re-runs the SAME generation path — a second POST really is issued", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const probe = await renderReportRouteForSearch(
      "instant=true&addr=100+E+Test+St&lat=41.75&lon=-87.6",
    );

    await screen.findByTestId("report-generation-error", undefined, { timeout: 10_000 });
    const attemptsBefore = probe.generateCalls();
    expect(attemptsBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("report-generation-retry"));

    // Back to the honest loading state while the retry is in flight...
    await waitFor(() => expect(screen.queryByText(SPINNER_TEXT)).toBeTruthy());
    // ...and the generation endpoint is actually called again.
    await waitFor(() => expect(probe.generateCalls()).toBeGreaterThan(attemptsBefore), {
      timeout: 10_000,
    });
  });
});

describe("corridor mode: a failed generation gets its own honest card, not the spinner", () => {
  it("shows the retry card rather than 'Generating Corridor Intelligence' forever", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderReportRouteForSearch("corridor=60636&preview=corridor-poc");

    const card = await screen.findByTestId("report-generation-error", undefined, {
      timeout: 10_000,
    });

    expect(screen.queryByText(CORRIDOR_SPINNER_TEXT)).toBeNull();
    expect(card.textContent).toContain("We couldn't generate your report");
    expect(screen.getByTestId("report-generation-retry")).toBeTruthy();
  });

  /**
   * The follow-up finding this mirrors. The corridor card rendered and the
   * button was clickable, but `retry()` re-armed the path by calling
   * `setCorridorAutoGenerated(false)` — and that flag is only ever set true on
   * SUCCESS, so after a failure it was ALREADY false. React bailed out of the
   * no-op write, nothing in the effect's dep array changed, and no second POST
   * was issued: the card just unmounted and left the reader in a blank wizard,
   * with `report` null and both loading gates false. The test above could not
   * catch it, because it never clicked the button.
   *
   * This is the corridor twin of the instant "real second POST" test — the
   * network probe, not the DOM, is the assertion.
   */
  it("the retry re-runs the SAME generation path — a second POST really is issued", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const probe = await renderReportRouteForSearch("corridor=60636&preview=corridor-poc");

    await screen.findByTestId("report-generation-error", undefined, { timeout: 10_000 });
    const attemptsBefore = probe.generateCalls();
    expect(attemptsBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("report-generation-retry"));

    // The reader goes back to the honest loading state, not to a blank wizard.
    await waitFor(() => expect(screen.queryByText(CORRIDOR_SPINNER_TEXT)).toBeTruthy());
    await waitFor(() => expect(probe.generateCalls()).toBeGreaterThan(attemptsBefore), {
      timeout: 10_000,
    });
    // And it lands back on the honest card when the retry fails too — never on
    // an empty wizard, which is what the dead re-arm actually produced.
    await screen.findByTestId("report-generation-error", undefined, { timeout: 10_000 });
  });
});

describe("shared-report mode: the retry is a real second attempt, not a state reset", () => {
  it("renders the honest card for a shared link whose generation failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderReportRouteForSearch(SHARED_REPORT_SEARCH);

    const card = await screen.findByTestId("report-generation-error", undefined, {
      timeout: 10_000,
    });

    // The shared-report path has its own copy: the reader did not build this
    // report, so the honest thing to say is that the LINK could not be opened
    // and that the link itself is not the problem.
    expect(card.textContent).toContain("We couldn't open this shared report");
    expect(card.textContent).toContain("The link itself is fine");
    expect(card.textContent).not.toMatch(/eligib|qualif|no programs|no incentives/i);
    expect(screen.getByTestId("report-generation-retry")).toBeTruthy();
  });

  /**
   * Same dead re-arm as corridor, via `setShareAutoGenerated(false)`, and with
   * no test of any kind before this one — the shared-report retry shipped
   * never having been clicked.
   */
  it("the retry re-runs the SAME generation path — a second POST really is issued", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const probe = await renderReportRouteForSearch(SHARED_REPORT_SEARCH);

    await screen.findByTestId("report-generation-error", undefined, { timeout: 10_000 });
    const attemptsBefore = probe.generateCalls();
    expect(attemptsBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("report-generation-retry"));

    await waitFor(() => expect(probe.generateCalls()).toBeGreaterThan(attemptsBefore), {
      timeout: 10_000,
    });
    await screen.findByTestId("report-generation-error", undefined, { timeout: 10_000 });
  });
});
