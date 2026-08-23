import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Each test below does a fresh `vi.resetModules()` + dynamic re-import of
// app/report/page.tsx's whole module graph (required for the seeded-`react`
// technique below to pick up a fresh `useState` closure per render — see
// `renderReportRoute`). That's several hundred transitive modules re-evaluated
// per test; under full-suite contention this comfortably exceeds vitest's
// default 5s test timeout even though each render itself is fast.
vi.setConfig({ testTimeout: 20_000 });
import { INITIAL_WIZARD_STATE } from "@/lib/report-wizard-config";
import type { WizardState } from "@/lib/report-wizard-config";
import { reportEmailGateKey } from "@/lib/report-email";
import { DEFAULT_PERSONA } from "@/lib/personas";
import { SUPPORT_ORGANIZATIONS_SECTION_TITLE } from "@/lib/support-organization-copy";
import type { GeneratedReport } from "@/lib/report-engine";

/**
 * Characterization coverage for the LIVE report route's own renderer —
 * the unexported `ReportDisplay` function inside app/report/page.tsx
 * (~4100-5900), a fork of components/report/ReportDisplay.tsx that is
 * otherwise untested. See components/report/__tests__/public-report-display.test.tsx
 * for the shared saved-report component this is NOT the same code as.
 *
 * WHY THIS FILE LOOKS THE WAY IT DOES
 *
 * `ReportDisplay` is a private function in a 6000+ line client page, called
 * from `ReportWizardPage` only after `report` state is set — state that in
 * production is populated by chained `useEffect`s driven by `fetch` calls to
 * half a dozen endpoints (census, zoning, TIF finance, transport, etc.) and
 * `setTimeout` debounces. This repo has no DOM environment (no jsdom, no
 * happy-dom, no testing-library — see components/map/__tests__/map-search.test.tsx
 * for the prior art on that constraint), so `useEffect` bodies never run
 * during `renderToStaticMarkup`, and neither export nor prop exists to force
 * a rendered report into view.
 *
 * The technique below — proven in map-search.test.tsx at a 4-hook scale — is
 * scaled up here to the full set of `useState` calls that unconditionally
 * execute before `ReportDisplay` is reached: `react`'s `useState` is patched
 * to pull from a pre-seeded, ordinally-matched array instead of running the
 * real initializers, while `useEffect`/`useMemo`/`useCallback`/`useRef` stay
 * real (harmless: their effect bodies don't run in a single synchronous
 * render pass, and memo/callback bodies compute correctly off the seeded
 * state). Every OTHER component this file imports that carries its own
 * `useState` — accordions, tooltips, framer-motion, the dozen child
 * components mounted directly under `ReportDisplay` — is mocked to a
 * hookless stub below, both to keep the ordinal slot list to page.tsx's own
 * hooks and to avoid depending on third-party internals this suite doesn't
 * own.
 *
 * MAINTENANCE WARNING — READ BEFORE EDITING app/report/page.tsx
 *
 * `REPORT_WIZARD_PAGE_STATE_ORDER` and `REPORT_DISPLAY_STATE_ORDER` below
 * must exactly match the order `useState` is called in `ReportWizardPage`
 * (lines ~622-1261) and `ReportDisplay` (lines ~4152-4499) respectively. Any
 * added, removed, or reordered `useState` call in either function — even one
 * completely unrelated to what this file asserts on — desyncs every slot
 * after it. That usually surfaces as a loud runtime error (a boolean fed to
 * something expecting an array, etc.), but a same-shape swap (e.g. two
 * adjacent `useState(false)` calls trading places) would desync silently. If
 * this file starts failing after an unrelated page.tsx change, regenerate
 * the two order arrays first — with a `const [name] = useState` capture over
 * the same line ranges — before assuming the covered behavior itself broke.
 *
 * WHAT THIS FILE COVERS
 *   - Sections render in `report.sections` array order (engine order),
 *     regardless of disclosure state.
 *   - Prohibited eligibility-determination phrases ("appears eligible",
 *     "high match", dollar-figure benefit claims, etc.) do not reach the
 *     live route's rendered HTML, for a legacy-shaped report that carries
 *     every one of those fields — i.e. this proves `ReportDisplay` in
 *     page.tsx actually calls `normalizePublicReportForDisplay` and doesn't
 *     read the raw legacy fields anywhere in its own JSX, not just that the
 *     normalizer function is correct in isolation (already covered by
 *     lib/__tests__/public-report-safety.test.ts) or that the OTHER renderer
 *     is safe (public-report-display.test.tsx).
 *   - The zoning-review + stage-handoff surface (`ZoningReviewQuestions`)
 *     mounts, with the right props, exactly when `metadata.zoneClass` is
 *     present, and does not mount when it is absent.
 *   - Disclosure state: the first two sections and the two
 *     `ALWAYS_OPEN_SECTIONS` titles ("Programs Mapped at This Address",
 *     the support-organizations title) render open; a later, ordinary
 *     section renders collapsed — matching app/report/page.tsx ~4222-4234.
 *
 * WHAT THIS FILE DOES NOT COVER
 *   - Anything behind a click, toggle, or fetch: expand/collapse
 *     interaction, the email gate, refine, save/share, the vacancy
 *     spreadsheet export, admin ownership loading. No DOM environment means
 *     no events fire; `renderToStaticMarkup` is markup only.
 *   - The dozen mocked child components' own rendering (AdminOwnershipPanel,
 *     CapitalPartnerHandoff, ZoningReviewQuestions itself, etc.) — those
 *     have, or should have, their own test files. This file only proves
 *     `ReportDisplay` decides to mount them, with which props, under which
 *     conditions.
 *   - The wizard-step UI (address entry, industry/budget/etc. steps) that
 *     `ReportWizardPage` renders before `report` is set — out of scope for
 *     "the live report route's renderer."
 */

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...rest
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <div {...rest}>{children as React.ReactNode}</div>
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/accordion", () => ({
  Accordion: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-stub="accordion" className={className}>{children}</div>
  ),
  AccordionItem: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-stub="accordion-item" className={className}>{children}</div>
  ),
  AccordionTrigger: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-stub="accordion-trigger" className={className}>{children}</div>
  ),
  AccordionContent: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-stub="accordion-content" className={className}>{children}</div>
  ),
}));

vi.mock("@/components/zoning/ZoningReviewQuestions", () => ({
  ZoningReviewQuestions: (props: {
    zoneClass: string;
    address?: string;
    businessType?: string;
    siteSpecificOrdinanceUrl?: string;
  }) => (
    <div
      data-testid="stub-zoning-review-questions"
      data-zone-class={props.zoneClass}
      data-address={props.address ?? ""}
      data-business-type={props.businessType ?? ""}
      data-ordinance-url={props.siteSpecificOrdinanceUrl ?? ""}
    />
  ),
}));

vi.mock("@/components/report/ReportZoningMap", () => ({
  default: () => <div data-testid="stub-report-zoning-map" />,
}));

vi.mock("@/components/report/SiteActivityCard", () => ({
  SiteActivityCard: () => <div data-testid="stub-site-activity-card" />,
}));

vi.mock("@/components/report/CrossLinkBanner", () => ({
  InlineCrossLinkBanner: () => <div data-testid="stub-inline-cross-link" />,
  StickyCrossLinkBanner: () => <div data-testid="stub-sticky-cross-link" />,
}));

vi.mock("@/components/report/ReportEmailGate", () => ({
  ReportEmailGate: () => <div data-testid="stub-report-email-gate" />,
}));

vi.mock("@/components/concierge/SiteConciergeProvider", () => ({
  ConciergePageContextBridge: () => <div data-testid="stub-concierge-bridge" />,
}));

vi.mock("@/components/report/RefineValuePanel", () => ({
  RefineValuePanel: () => <div data-testid="stub-refine-value-panel" />,
}));

vi.mock("@/components/report/PersonaChips", () => ({
  PersonaChips: () => <div data-testid="stub-persona-chips" />,
}));

vi.mock("@/components/report/GroupedReportDetail", () => ({
  GroupedReportDetail: () => <div data-testid="stub-grouped-report-detail" />,
}));

vi.mock("@/components/incentive-preparation/StartPreparationPacketButton", () => ({
  StartPreparationPacketButton: () => <div data-testid="stub-start-preparation-packet" />,
}));

vi.mock("@/components/report/AdminOwnershipPanel", () => ({
  AdminOwnershipPanel: () => <div data-testid="stub-admin-ownership-panel" />,
}));

vi.mock("@/components/report/CapitalPartnerHandoff", () => ({
  CapitalPartnerHandoff: () => <div data-testid="stub-capital-partner-handoff" />,
}));

vi.mock("@/components/workspace/SaveReportModal", () => ({
  SaveReportModal: () => <div data-testid="stub-save-report-modal" />,
}));

/**
 * `useState` call order inside `ReportWizardPage`, app/report/page.tsx
 * lines ~622-1261. Extracted mechanically (regex over that line range for
 * `const [x, setX] = useState`) rather than by eye — see the maintenance
 * warning above for how to regenerate this if it drifts.
 */
const REPORT_WIZARD_PAGE_STATE_ORDER = [
  "wizardState",
  "currentStepIndex",
  "direction",
  "report",
  "isGenerating",
  "hasRefinedInstantReport",
  "revealedReportKey",
  "crossLinkDismissed",
  "bottomZoneInView",
  "compareMode",
  "compareReport",
  "compareAddressInput",
  "compareGeocoding",
  "compareGeoResult",
  "compareZones",
  "compareZoneNames",
  "compareZoneUnknowns",
  "compareCensus",
  "compareZoning",
  "compareZoningKey",
  "compareParcel",
  "compareNeighborhoodEconomics",
  "compareNeighborhoodEconomicsZip",
  // review6 S11 (CRITICAL, S1 reopened): "programs" (client-side
  // Program[] state) removed here — report generation moved server-side
  // (POST /api/report/generate); this slot no longer exists in
  // ReportWizardPage. Removed from this order array in the SAME change,
  // per this file's own maintenance warning above.
  "zones",
  "zoneNames",
  "zoneUnknowns",
  "zoneCheckedAt",
  "censusData",
  "cityZoning",
  "cityZoningKey",
  "parcelData",
  "parcelLookupComplete",
  "districtsData",
  "stackingRules",
  "communityAssets",
  "localBusinessSupport",
  "siteSignals",
  "transportAccess",
  "mobilityAccess",
  "areaStats",
  "corridorMetric",
  "corridorOwnerClusters",
  "corridorLoading",
  "neighborhoodEconomics",
  "neighborhoodEconomicsZip",
  "addressInput",
  "geocodeResult",
  "isGeocoding",
  "geocodeError",
  "instantLoading",
  "reverseZip",
  "corridorAutoGenerated",
  "shareAutoGenerated",
] as const;

/**
 * `useState` call order inside `ReportDisplay`, app/report/page.tsx lines
 * ~4152-4499 (continues the SAME shared slot counter, since the mocked
 * `useState` is a single module-level function shared by every component in
 * the render tree — `ReportDisplay` is rendered as a child of
 * `ReportWizardPage` within the same synchronous pass).
 */
const REPORT_DISPLAY_STATE_ORDER = [
  "linkCopied",
  "emailDialogOpen",
  "isEditingSummary",
  "saveModalOpen",
  "isExportingVacancySpreadsheet",
  "isLoadingVacancySpreadsheet",
  "vacancySpreadsheetFeatures",
  "vacancySpreadsheetError",
  "editedSummaryText",
  "persona",
  "expandedSections",
  "downloadGateOpen",
  "adminOwnershipStatus",
  "adminOwnershipMatch",
  "adminOwnershipTopClusters",
] as const;

const FULL_STATE_ORDER = [
  ...REPORT_WIZARD_PAGE_STATE_ORDER,
  ...REPORT_DISPLAY_STATE_ORDER,
];

type StateSlotName = (typeof FULL_STATE_ORDER)[number];

function defaultSlotValues(): Record<StateSlotName, unknown> {
  return {
    wizardState: INITIAL_WIZARD_STATE,
    currentStepIndex: 0,
    direction: 1,
    report: null,
    isGenerating: false,
    hasRefinedInstantReport: false,
    revealedReportKey: null,
    crossLinkDismissed: false,
    bottomZoneInView: false,
    compareMode: false,
    compareReport: null,
    compareAddressInput: "",
    compareGeocoding: false,
    compareGeoResult: null,
    compareZones: null,
    compareZoneNames: null,
    compareZoneUnknowns: [],
    compareCensus: null,
    compareZoning: null,
    compareZoningKey: null,
    compareParcel: null,
    compareNeighborhoodEconomics: null,
    compareNeighborhoodEconomicsZip: null,
    zones: null,
    zoneNames: null,
    zoneUnknowns: [],
    zoneCheckedAt: null,
    censusData: null,
    cityZoning: null,
    cityZoningKey: null,
    parcelData: null,
    parcelLookupComplete: false,
    districtsData: null,
    stackingRules: null,
    communityAssets: null,
    localBusinessSupport: undefined,
    siteSignals: undefined,
    transportAccess: undefined,
    mobilityAccess: undefined,
    areaStats: null,
    corridorMetric: null,
    corridorOwnerClusters: [],
    corridorLoading: false,
    neighborhoodEconomics: null,
    neighborhoodEconomicsZip: null,
    addressInput: "",
    geocodeResult: null,
    isGeocoding: false,
    geocodeError: null,
    instantLoading: false,
    reverseZip: null,
    corridorAutoGenerated: false,
    shareAutoGenerated: false,
    linkCopied: false,
    emailDialogOpen: false,
    isEditingSummary: false,
    saveModalOpen: false,
    isExportingVacancySpreadsheet: false,
    isLoadingVacancySpreadsheet: false,
    vacancySpreadsheetFeatures: null,
    vacancySpreadsheetError: null,
    editedSummaryText: "",
    persona: DEFAULT_PERSONA,
    // Left at the real default ({}) deliberately: this is exactly what lets
    // `isSectionOpen` fall through to its idx<2 / ALWAYS_OPEN_SECTIONS rule,
    // which is the behavior under test.
    expandedSections: {},
    downloadGateOpen: false,
    adminOwnershipStatus: "idle",
    adminOwnershipMatch: null,
    adminOwnershipTopClusters: [],
  };
}

/**
 * Renders the live route (`app/report/page.tsx`'s default export) with
 * `report` state seeded directly to `report`, bypassing the fetch/effect
 * pipeline that populates it in production. `wizardState` is seeded to stay
 * consistent with `report.metadata`; `revealedReportKey` is seeded to match
 * so the (mocked) email gate doesn't need to factor into what's asserted.
 */
async function renderReportRoute(
  report: GeneratedReport,
  wizardState: WizardState,
  extraOverrides: Partial<Record<StateSlotName, unknown>> = {},
): Promise<string> {
  const overrides: Partial<Record<StateSlotName, unknown>> = {
    wizardState,
    report,
    revealedReportKey: reportEmailGateKey(report),
    ...extraOverrides,
  };
  const values = { ...defaultSlotValues(), ...overrides };
  const seeds = FULL_STATE_ORDER.map((name) => values[name]);

  vi.resetModules();
  vi.doMock("react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react")>();
    let slot = 0;
    return { ...actual, useState: () => [seeds[slot++], () => {}] };
  });
  const { default: ReportPageWrapper } = await import("../page");
  const html = renderToStaticMarkup(<ReportPageWrapper />);
  vi.doUnmock("react");
  vi.resetModules();
  return html;
}

const BASE_WIZARD_STATE: WizardState = {
  ...INITIAL_WIZARD_STATE,
  reportType: "site-incentives",
  address: "100 E Test St",
  lat: 41.8,
  lon: -87.6,
};

function baseSections(zoneClass: string | undefined): GeneratedReport["sections"] {
  return [
    {
      title: "Site Overview",
      description: "Factual context for this address.",
      items: [{ label: "Community Area", value: "South Chicago" }],
    },
    {
      title: "Zoning & Use Starting Point",
      description: "Published zoning classification for this parcel.",
      items: zoneClass
        ? [{
            label: "City Zoning Classification",
            value: zoneClass,
            url: "https://gisapps.chicago.gov/zoning",
          }]
        : [],
    },
    {
      // Index 2 — beyond the idx<2 default-open range, so staying open here
      // only happens through ALWAYS_OPEN_SECTIONS, not the generic rule.
      title: "Programs Mapped at This Address",
      description: "Appears eligible for a potential incentive of $40,000.",
      items: [
        {
          label: "High Match Legacy Program with projected incentive of $30,000",
          value: "$25,000 possible benefit",
          detail: "You qualify for a possible incentive of $20,000.",
          programId: "legacy-program",
          confidenceLabel: "High Match",
          whyOneLine: "You qualify based on this location.",
          matchedRules: [
            "You qualify for a possible incentive of $15,000 because you plan to hire.",
          ],
          notVerified: [
            "High Match; confirm projected incentive of $12,000 and payroll records.",
          ],
          eligibilityRules: [
            { description: "Eligible applicants must be in good standing.", required: true },
          ],
          sourceUrl: "https://example.com/legacy-program",
        },
      ],
    },
    {
      // Index 3 — not in ALWAYS_OPEN_SECTIONS, not idx<2: must render
      // collapsed by default.
      title: "Upcoming Deadlines Near This Address",
      items: [{
        label: "Test Program application deadline",
        value: "December 15, 2026",
        detail: "Confirm the current filing window.",
        programId: "deadline-program",
      }],
    },
    {
      title: SUPPORT_ORGANIZATIONS_SECTION_TITLE,
      description: "Local organizations that provide free advising and application assistance.",
      items: [
        { label: "Local Support in South Chicago", value: "1 organization" },
        {
          label: "Example Support Org",
          value: "Primary local access point",
          detail: "Published support services: Business advising",
          url: "https://example.com/support-org",
        },
      ],
    },
  ];
}

function buildReport(
  options: { zoneClass?: string; withStartHere?: boolean } = {},
): GeneratedReport {
  const zoneClass = options.zoneClass;
  return {
    title: "Eligible Incentive Programs",
    subtitle: "Appears eligible based on location",
    reportType: "site-incentives",
    generatedAt: "2026-08-01T00:00:00.000Z",
    summary: "You may qualify for a High Match program with a possible benefit of $25,000-$50,000.",
    verdict: {
      signal: "strong",
      headline: "High Match with a potential incentive of $50,000",
      subheadline: "You qualify for an estimated $25,000 benefit",
      topReasons: ["Appears eligible for a benefit range of $25,000-$50,000"],
    },
    sections: baseSections(zoneClass),
    recommendedActions: [
      {
        label: "Claim a possible $25,000 incentive",
        description: "You qualify for a projected award of $25,000.",
        priority: "high",
      },
    ],
    actionRoadmap: [
      {
        tier: "do-this-week",
        label: "Pursue an estimated $50,000 benefit",
        description: "Appears eligible for a potential incentive of $50,000.",
        callScript: "Tell them you qualify for up to $50,000.",
      },
    ],
    metadata: {
      address: "100 E Test St",
      industry: "retail",
      ...(zoneClass ? { zoneClass, zoneType: "Business" } : {}),
    },
    ...(options.withStartHere
      ? {
          startHere: {
            primary: {
              label: "Call Test Agency about the TIF Program",
              description: "A test program that reimburses a share of facade costs.",
              kind: "call-agency",
              programId: "tif",
              contact: { agency: "Test Agency", abbreviation: "TA", phone: "312-555-0000" },
            },
            secondary: [],
            evidence: [],
            unresolvedQuestions: [],
            audience: "site-incentives",
          },
        }
      : {}),
  } as unknown as GeneratedReport;
}

const PROHIBITED_DETERMINATIONS =
  /appears eligible|may qualify|you qualify|eligible incentive programs|high match|medium match/i;

function sectionAnchor(title: string): string {
  if (title === SUPPORT_ORGANIZATIONS_SECTION_TITLE) return "your-support-network";
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The class attribute React emitted on the `<div id="...">` section wrapper. */
function sectionWrapperClasses(html: string, anchor: string): string {
  const match = html.match(new RegExp(`<div id="${anchor}" class="([^"]*)"`));
  expect(match, `rendered section wrapper for #${anchor}`).toBeTruthy();
  return match![1];
}

describe("live report route renderer (app/report/page.tsx ReportDisplay)", () => {
  it("renders sections in engine order (report.sections array order)", async () => {
    const report = buildReport({ zoneClass: "B3-2" });
    const html = await renderReportRoute(report, BASE_WIZARD_STATE);

    const anchors = report.sections.map((s) => sectionAnchor(s.title));
    const positions = anchors.map((anchor) => {
      const idx = html.indexOf(`id="${anchor}"`);
      expect(idx, `section anchor #${anchor} present in output`).toBeGreaterThanOrEqual(0);
      return idx;
    });

    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("keeps prohibited eligibility-determination phrases and dollar claims out of the rendered HTML", async () => {
    const report = buildReport({ zoneClass: "B3-2" });
    const html = await renderReportRoute(report, BASE_WIZARD_STATE);

    expect(html).not.toMatch(PROHIBITED_DETERMINATIONS);
    expect(html).not.toContain("$50,000");
    expect(html).not.toContain("$25,000");
    expect(html).not.toContain("$30,000");
    expect(html).not.toContain("$20,000");
    expect(html).not.toContain("$15,000");
    expect(html).not.toContain("$12,000");
    expect(html).not.toContain("$40,000");
    expect(html).toContain("Review published terms");
  });

  it("mounts the zoning-review + stage-handoff surface when metadata.zoneClass is present", async () => {
    const report = buildReport({ zoneClass: "B3-2" });
    const html = await renderReportRoute(report, BASE_WIZARD_STATE);

    expect(html).toContain('data-testid="stub-zoning-review-questions"');
    expect(html).toContain('data-zone-class="B3-2"');
    expect(html).toContain('data-address="100 E Test St"');
    expect(html).toContain('data-business-type="retail"');
    expect(html).toContain('data-ordinance-url="https://gisapps.chicago.gov/zoning"');
  });

  it("does not mount the zoning-review surface when metadata.zoneClass is absent", async () => {
    const report = buildReport({});
    const html = await renderReportRoute(report, BASE_WIZARD_STATE);

    expect(html).not.toContain('data-testid="stub-zoning-review-questions"');
  });

  it("opens the first two sections and both ALWAYS_OPEN_SECTIONS titles by default", async () => {
    const report = buildReport({ zoneClass: "B3-2" });
    const html = await renderReportRoute(report, BASE_WIZARD_STATE);

    // idx 0: "Site Overview" — open via idx<2
    expect(sectionWrapperClasses(html, "site-overview")).not.toContain(
      "report-section-collapsed",
    );
    // idx 1: "Zoning & Use Starting Point" — open via idx<2
    expect(sectionWrapperClasses(html, "zoning-use-starting-point")).not.toContain(
      "report-section-collapsed",
    );
    // idx 2: "Programs Mapped at This Address" — open ONLY via
    // ALWAYS_OPEN_SECTIONS (idx<2 does not apply at index 2)
    expect(
      sectionWrapperClasses(html, "programs-mapped-at-this-address"),
    ).not.toContain("report-section-collapsed");
    // support-network section — open via ALWAYS_OPEN_SECTIONS
    expect(sectionWrapperClasses(html, "your-support-network")).not.toContain(
      "report-section-collapsed",
    );
  });

  it("collapses an ordinary section beyond the first two by default", async () => {
    const report = buildReport({ zoneClass: "B3-2" });
    const html = await renderReportRoute(report, BASE_WIZARD_STATE);

    // idx 3: "Upcoming Deadlines Near This Address" — not idx<2, not in
    // ALWAYS_OPEN_SECTIONS: must render collapsed by default. Content stays
    // in the DOM (progressive disclosure, not hidden) so the deadline text
    // itself must still be present.
    expect(
      sectionWrapperClasses(html, "upcoming-deadlines-near-this-address"),
    ).toContain("report-section-collapsed");
    expect(html).toContain("December 15, 2026");
  });

  it("does not render the Start Here card, and renders recommendedActions in its original (non-<details>) form, when report.startHere is absent", async () => {
    const report = buildReport({ zoneClass: "B3-2" });
    const html = await renderReportRoute(report, BASE_WIZARD_STATE);

    expect(html).not.toContain('id="start-here"');
    expect(html).not.toContain("start-here-card");
    expect(html).not.toMatch(/<details[^>]*id="recommended-actions"/);
    expect(html).toMatch(/<div id="recommended-actions"/);
  });

  it("renders the Start Here card as the first content block, primary action dominant, and demotes recommendedActions behind disclosure when report.startHere is present", async () => {
    const report = buildReport({ zoneClass: "B3-2", withStartHere: true });
    const html = await renderReportRoute(report, BASE_WIZARD_STATE);

    expect(html).toContain('id="start-here"');
    expect(html).toContain("Call Test Agency about the TIF Program");
    expect(html).toContain('href="tel:312-555-0000"');

    const startHereIdx = html.indexOf('id="start-here"');
    const verdictIdx = html.indexOf('id="verdict"');
    expect(startHereIdx).toBeGreaterThanOrEqual(0);
    expect(verdictIdx).toBeGreaterThan(startHereIdx);

    // recommendedActions still reachable, just demoted behind disclosure —
    // content stays in the DOM (progressive disclosure, not hidden).
    expect(html).toMatch(/<details[^>]*id="recommended-actions"/);
    expect(html).toContain("Recommended Actions · 1");
    // The recommended-action label itself is normalized by the public-safety
    // layer (dollar claim stripped) — this asserts the demoted block's
    // content survives that normalization and stays present in the DOM.
    expect(html).toContain("Claim published program terms");
    expect(html).toContain("High Priority");
  });

  describe("Part-03 correction: Contact Sheet is the ONLY Part 03 section on a real persona lens", () => {
    it("suppresses the raw support-organizations section and renders the Contact Sheet instead", async () => {
      const report = buildReport({ zoneClass: "B3-2" });
      const html = await renderReportRoute(report, BASE_WIZARD_STATE, { persona: "developer" });

      // The raw support-org section wrapper is gone...
      expect(html).not.toContain('id="your-support-network"');
      // ...but its content still reaches the reader via the Contact Sheet
      // (lane-ranked, why-lined), not silently dropped.
      expect(html).toContain('data-testid="contact-sheet"');
    });

    it("keeps the raw support-organizations section on 'all' (no Contact Sheet, no guidepost)", async () => {
      const report = buildReport({ zoneClass: "B3-2" });
      const html = await renderReportRoute(report, BASE_WIZARD_STATE, { persona: "all" });

      expect(html).toContain('id="your-support-network"');
      expect(html).not.toContain('data-testid="contact-sheet"');
    });
  });

  describe("Documents to Gather (spec v2 item 3): owner + supporter only, real Business File content", () => {
    it("renders for 'growing' (owner) with the real foundation-task titles", async () => {
      const report = buildReport({ zoneClass: "B3-2" });
      const html = await renderReportRoute(report, BASE_WIZARD_STATE, { persona: "growing" });

      expect(html).toContain('data-testid="documents-to-gather"');
      expect(html).toContain("Confirm the business identity");
      expect(html).toContain("Track in Business File");
      expect(html).toContain('href="/workspace/business-file"');
    });

    it("renders for 'supporter'", async () => {
      const report = buildReport({ zoneClass: "B3-2" });
      const html = await renderReportRoute(report, BASE_WIZARD_STATE, { persona: "supporter" });

      expect(html).toContain('data-testid="documents-to-gather"');
    });

    it("does NOT render for 'developer' (scoped to owner + supporter only)", async () => {
      const report = buildReport({ zoneClass: "B3-2" });
      const html = await renderReportRoute(report, BASE_WIZARD_STATE, { persona: "developer" });

      expect(html).not.toContain('data-testid="documents-to-gather"');
    });

    it("does NOT render on 'all'", async () => {
      const report = buildReport({ zoneClass: "B3-2" });
      const html = await renderReportRoute(report, BASE_WIZARD_STATE, { persona: "all" });

      expect(html).not.toContain('data-testid="documents-to-gather"');
    });
  });
});
