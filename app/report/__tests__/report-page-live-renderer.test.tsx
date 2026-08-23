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
import { DEFAULT_BRIEF_UI_STATE } from "@/lib/report-brief";
import { SUPPORT_ORGANIZATIONS_SECTION_TITLE } from "@/lib/support-organization-copy";
import { CONFIRMED_PROGRAMS_SECTION_ID, CONFIRMED_PROGRAMS_SECTION_TITLE } from "@/lib/report-engine";
import type { GeneratedReport } from "@/lib/report-engine";
import { ALSO_AT_ADDRESS_TITLE, personaEmptyProgramsDescription } from "@/lib/report-personas";
import { encodeWizardState } from "@/lib/url-state";

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
  // spec v2 item 5 (The Brief): a single new useState slot, added
  // immediately after downloadGateOpen in the source — see the
  // maintenance warning above for why this array must move in the SAME
  // commit as the source addition.
  "briefState",
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
    briefState: DEFAULT_BRIEF_UI_STATE,
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

  describe("The Brief (spec v2 item 5)", () => {
    it("offers 'Build My Brief' on a real persona lens", async () => {
      const report = buildReport({ zoneClass: "B3-2" });
      const html = await renderReportRoute(report, BASE_WIZARD_STATE, { persona: "growing" });
      expect(html).toContain("Build My Brief");
    });

    it("does not offer 'Build My Brief' on 'all'", async () => {
      const report = buildReport({ zoneClass: "B3-2" });
      const html = await renderReportRoute(report, BASE_WIZARD_STATE, { persona: "all" });
      expect(html).not.toContain("Build My Brief");
    });

    it("renders the open Brief overlay (seeded via briefState) with the non-suppressible footer and no documents block", async () => {
      const report = buildReport({ zoneClass: "B3-2" });
      const html = await renderReportRoute(report, BASE_WIZARD_STATE, {
        persona: "growing",
        briefState: { askOpen: false, open: true, stage: "launch-ready", priority: "renovation" },
      });
      expect(html).toContain('data-testid="brief-page"');
      expect(html).toContain("SCREENING FROM PUBLIC RECORDS");
      // The underlying report (growing persona) legitimately has its own
      // Documents to Gather block — scope the "Brief carries no documents
      // block" assertion to the brief-overlay fragment specifically.
      const overlayStart = html.indexOf('id="brief-overlay"');
      const overlayHtml = html.slice(overlayStart);
      expect(overlayHtml).not.toContain("Documents to Gather");
      expect(overlayHtml).not.toContain("Track in Business File");
    });
  });

  // Gate finding 16: a REAL DOM-level floor suite (render-level assertions
  // against renderToStaticMarkup output, not source-code greps). Uses REAL
  // catalog program ids (sbif/tif/federalOZ/highUnemployment) so the hard
  // relevance filter (lib/report-personas.ts applyPersonaLens) actually
  // engages — sbif matches starting/growing only, tif+federalOZ match
  // developer, highUnemployment is a PINNED overlay (context, not a
  // program — always visible regardless of persona match).
  describe("Floor suite (gate finding 16): hard-filter disclosure, sources footer, reason pills, overlay pinning, empty state", () => {
    function multiProgramReport(): GeneratedReport {
      return {
        title: "Site Incentive Analysis",
        subtitle: "Location-based analysis",
        reportType: "site-incentives",
        generatedAt: "2026-08-01T00:00:00.000Z",
        summary: "Mapped incentive zones were found at this address.",
        sections: [
          {
            id: CONFIRMED_PROGRAMS_SECTION_ID,
            title: CONFIRMED_PROGRAMS_SECTION_TITLE,
            description: "Programs mapped at this address.",
            items: [
              {
                label: "SBIF Facade Grant",
                value: "Review published terms",
                programId: "sbif",
                matchExplanation: {
                  whyItAppears: ["Address falls inside an SBIF-eligible TIF district"],
                  knownFromPublicData: [],
                  basedOnUserAnswers: [],
                  stillToConfirm: [],
                  currentDocumentsToGather: [],
                  confirmWith: [],
                },
              },
              {
                label: "TIF District Program",
                value: "Review published terms",
                programId: "tif",
                matchExplanation: {
                  whyItAppears: ["Address falls inside a TIF district"],
                  knownFromPublicData: [],
                  basedOnUserAnswers: [],
                  stillToConfirm: [],
                  currentDocumentsToGather: [],
                  confirmWith: [],
                },
              },
              {
                label: "Federal Opportunity Zone",
                value: "Review published terms",
                programId: "federalOZ",
              },
              {
                label: "High Unemployment Area",
                value: "Context signal",
                programId: "highUnemployment",
              },
            ],
          },
        ],
        recommendedActions: [],
        metadata: { address: "100 E Test St" },
        dataSources: [
          {
            id: "zones",
            label: "City of Chicago & Illinois DCEO",
            description: "Incentive zone boundaries.",
            url: "https://data.cityofchicago.org",
          },
        ],
      } as unknown as GeneratedReport;
    }

    function emptyMatchReport(): GeneratedReport {
      return {
        ...multiProgramReport(),
        sections: [
          {
            id: CONFIRMED_PROGRAMS_SECTION_ID,
            title: CONFIRMED_PROGRAMS_SECTION_TITLE,
            description: "Programs mapped at this address.",
            items: [{ label: "SBIF Facade Grant", value: "Review published terms", programId: "sbif" }],
          },
        ],
      };
    }

    /** Slices out one section's own HTML fragment by its anchor, up to (not
     *  including) the next `<div id="` boundary — good enough to isolate
     *  "does X appear inside/outside this specific section" without a real
     *  DOM parser. */
    function sectionFragment(html: string, anchor: string): string {
      const start = html.indexOf(`id="${anchor}"`);
      expect(start, `section anchor #${anchor} present in output`).toBeGreaterThanOrEqual(0);
      const nextDivIdx = html.indexOf('<div id="', start + 1);
      return html.slice(start, nextDivIdx === -1 ? undefined : nextDivIdx);
    }

    // Gate round 2 tail item 1: the earlier version of this test only
    // checked absence from the ONE confirmed-programs fragment — true to
    // "not in that fragment," not to the test's own name ("never appears
    // outside the disclosure"), since the collapsed title could in
    // principle leak into some OTHER section (e.g. a debug dump, a
    // duplicate render, a stray TOC entry) and this test would still have
    // been green. Strengthened to the full document: slice out the
    // disclosure fragment itself, then assert the title is absent from
    // everything that remains — genuinely "never appears outside," not
    // "doesn't appear in this one place I checked."
    it("(a) a collapsed program's title never appears outside the 'Also at this address' disclosure", async () => {
      const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, { persona: "developer" });
      const alsoFragment = sectionFragment(html, sectionAnchor(ALSO_AT_ADDRESS_TITLE));
      // sbif does NOT match "developer" — it must have collapsed INTO the
      // disclosure, not dropped.
      expect(alsoFragment).toContain("SBIF Facade Grant");
      // ...and it must be ABSENT everywhere else in the rendered document —
      // not merely absent from the confirmed-programs fragment specifically.
      const remainder = html.replace(alsoFragment, "");
      expect(remainder).not.toContain("SBIF Facade Grant");
    });

    it("(b) the disclosure sentence itself renders, naming the real count and persona", async () => {
      const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, { persona: "developer" });
      expect(html).toContain("1 other program tied to this address");
      expect(html).toContain("Nothing is removed; switch to All to see everything together.");
    });

    it("(c) the sources footer and the generated-date vintage line both render", async () => {
      const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, { persona: "developer" });
      expect(html).toContain('id="data-sources"');
      // React HTML-escapes "&" to "&amp;" on render — assert the escaped form.
      expect(html).toContain("City of Chicago &amp; Illinois DCEO");
      expect(html).toMatch(/This report was generated on/);
    });

    it("(d) reason pills (ReasonChips) render on the card face for a matched program with a real match reason", async () => {
      const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, { persona: "developer" });
      expect(html).toContain('data-testid="reason-chips"');
      expect(html).toContain("Address falls inside a TIF district");
    });

    it("(e) the pinned overlay (highUnemployment) stays visible on EVERY persona, even developer/starting/growing/supporter where it isn't itself persona-tagged", async () => {
      for (const persona of ["starting", "growing", "developer", "supporter"] as const) {
        const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, { persona });
        const confirmedFragment = sectionFragment(html, sectionAnchor(CONFIRMED_PROGRAMS_SECTION_TITLE));
        expect(confirmedFragment, `persona=${persona}`).toContain("High Unemployment Area");
      }
    });

    it("(e) explicit empty-state copy renders (never a blank page, never the unfiltered list) when a persona matches zero programs", async () => {
      // emptyMatchReport carries only sbif (starting/growing-tagged) with NO
      // pinned overlay — under "developer" the confirmed tier has zero
      // visible items, so the engine's own empty-state sentence must render.
      const html = await renderReportRoute(emptyMatchReport(), BASE_WIZARD_STATE, { persona: "developer" });
      // React HTML-escapes the quotes around "Also at this address" inside
      // this sentence (-> &quot;) — assert the unambiguous, quote-free lead
      // clause of the real engine-produced sentence instead of the raw
      // string, which would never literally appear in rendered HTML.
      const expectedLead = personaEmptyProgramsDescription("developer").split(' See "')[0];
      expect(html).toContain(expectedLead);
      // Non-tautological: confirm this ISN'T just always-present boilerplate
      // by proving it's ABSENT for a persona that DOES match (starting).
      const startingHtml = await renderReportRoute(emptyMatchReport(), BASE_WIZARD_STATE, { persona: "starting" });
      expect(startingHtml).not.toContain("No programs at this address matched");
    });

    // (f) Gate finding 16(f): shared-link-recipient.test.ts's fork-parity
    // checks are source-code greps (readFileSync + toContain against the
    // raw .tsx text) — they prove the RIGHT LINE OF CODE EXISTS, not that
    // it actually does anything at render time. This is the real render-
    // level proof: a recipient who opens a shared link whose decoded
    // wizard state (`pg=`) already carries a complete goal selection must
    // NOT see the email gate — the sender already cleared it. Mirrors
    // renderReportRoute's own vi.doMock/vi.doUnmock technique, applied to
    // next/navigation's useSearchParams (globally stubbed to an EMPTY
    // URLSearchParams for every other test in this file) so THIS one test
    // can simulate a real `?<encoded wizard state>` share URL.
    it("(f) a shared-link recipient with a complete decoded goal set is NOT re-blocked by the email gate (render-level, not a source grep)", async () => {
      const sharedWizardState: WizardState = {
        ...INITIAL_WIZARD_STATE,
        reportType: "site-incentives",
        address: "100 E Test St",
        lat: 41.8,
        lon: -87.6,
        projectGoals: ["hiring"],
      };
      const encoded = encodeWizardState(sharedWizardState);

      vi.resetModules();
      vi.doMock("next/navigation", () => ({
        useSearchParams: () => new URLSearchParams(encoded),
        useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
      }));
      let html: string;
      try {
        html = await renderReportRoute(multiProgramReport(), sharedWizardState, {
          persona: "all",
        });
      } finally {
        // Re-doMock back to the file's own top-level next/navigation stub
        // (line ~108) rather than vi.doUnmock — a bare doUnmock left the
        // NEXT test in this file rendering a stale "Loading..." state
        // (confirmed: the control test below passes alone, fails after
        // this one runs first — real cross-test pollution, not a flake).
        // Re-establishing the exact original mock shape is unambiguous.
        vi.doMock("next/navigation", () => ({
          useSearchParams: () => new URLSearchParams(),
          useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
        }));
        vi.resetModules();
      }

      expect(html).not.toContain('data-testid="stub-report-email-gate"');
    });

    it("(f) CONTROL: the same report/state WITHOUT a resolved share link (empty searchParams, the harness default) DOES show the gate — proves the assertion above isn't vacuous", async () => {
      const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, {
        persona: "all",
        revealedReportKey: "",
      });
      expect(html).toContain('data-testid="stub-report-email-gate"');
    });

    // Gate finding 9/10: the additive `looking` persona — render-level
    // proof its R5LookingFinal board panels actually mount, AND that bare
    // persona="all" stays byte-equivalent (the ruling's explicit
    // requirement) despite the new branch existing in the same file.
    // Nested inside Floor suite (not a sibling) to reuse its
    // multiProgramReport()/sectionFragment() helpers.
    describe("The 'looking' persona (gate finding 9/10, R5LookingFinal board)", () => {
    it("renders Location snapshot, What's notable, and Explore by interest for persona=looking", async () => {
      const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, { persona: "looking" });
      expect(html).toContain('data-testid="location-snapshot"');
      expect(html).toContain('data-testid="explore-by-interest"');
      expect(html).toContain("I own a business");
      expect(html).toContain("I support businesses");
      expect(html).toContain("I develop property");
      expect(html).toContain('data-testid="full-picture-line"');
    });

    it("does NOT collapse any program into 'Also at this address' for persona=looking — it is a screening-overview lens, not a filtered one", async () => {
      const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, { persona: "looking" });
      expect(html).not.toContain('id="also-at-this-address"');
      const confirmedFragment = sectionFragment(html, sectionAnchor(CONFIRMED_PROGRAMS_SECTION_TITLE));
      // sbif does not match ANY of the four filtering personas' tags, but
      // "looking" filters nothing — it must still be present on the face.
      expect(confirmedFragment).toContain("SBIF Facade Grant");
    });

    it("none of the looking-only panels render for any OTHER persona, including 'all'", async () => {
      for (const persona of ["all", "starting", "growing", "developer", "supporter"] as const) {
        const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, { persona });
        expect(html, `persona=${persona}`).not.toContain('data-testid="location-snapshot"');
        expect(html, `persona=${persona}`).not.toContain('data-testid="explore-by-interest"');
      }
    });

    // Gate round 2 tail item 2: this test's name used to claim
    // "characterization, not just a marker check" — false; the body below
    // only ever checked a handful of markers (absence of a few ids/strings,
    // presence of program names in one fragment), never full-markup
    // equality against anything. Renamed to what it actually is. The real
    // byte-level characterization now lives in the dedicated test right
    // after this one.
    it("bare persona=all shows the flat kitchen sink — no guidepost bands, no disclosure, no looking-only markers (marker check)", async () => {
      const html = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, { persona: "all" });
      // "all" renders the flat kitchen sink: no guidepost bands, no
      // Also-at-this-address disclosure (nothing is collapsed on "all"
      // either), none of the new looking-only markers, and the confirmed
      // section carries every program including the persona-mismatched one.
      expect(html).not.toContain('id="also-at-this-address"');
      expect(html).not.toContain("PART 01");
      expect(html).not.toContain("data-testid=\"location-snapshot\"");
      expect(html).not.toContain("data-testid=\"explore-by-interest\"");
      const confirmedFragment = sectionFragment(html, sectionAnchor(CONFIRMED_PROGRAMS_SECTION_TITLE));
      expect(confirmedFragment).toContain("SBIF Facade Grant");
      expect(confirmedFragment).toContain("TIF District Program");
      expect(confirmedFragment).toContain("Federal Opportunity Zone");
      expect(confirmedFragment).toContain("High Unemployment Area");
    });

    // Gate round 2 tail item 2 — the real byte-level characterization the
    // coordinator asked for. `applyPersonaLens(report, "all")` returns the
    // identical report REFERENCE (lib/report-personas.ts's own doc comment
    // on `PersonaLensResult.report`) — but that's a claim about the lens
    // FUNCTION, proven directly in lib/__tests__/report-personas.test.ts.
    // What was missing here is proof that this holds through the WHOLE
    // render pipeline: that running the real lens for persona="all" at
    // app/report/page.tsx's one call site (`showPersonaLens ?
    // applyPersonaLens(report, persona).report : report`) produces
    // full-document output IDENTICAL to never calling the lens at all.
    // Proven by mocking `applyPersonaLens` itself out to a bare pass-
    // through for one render and diffing the FULL markup against a normal
    // render — genuinely byte-level, not a handful of marker checks.
    it("persona=all render is full-markup byte-identical whether the real persona lens runs or is bypassed entirely (real characterization)", async () => {
      const withRealLens = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, {
        persona: "all",
      });

      vi.resetModules();
      vi.doMock("@/lib/report-personas", async (importOriginal) => {
        const actual = await importOriginal<typeof import("@/lib/report-personas")>();
        return {
          ...actual,
          // The one real call site (app/report/page.tsx) only ever reads
          // `.report` off this return value — see the grep-backed claim in
          // the comment above; a bare pass-through is a faithful bypass.
          applyPersonaLens: (report: GeneratedReport) => ({
            report,
            matchedBefore: 0,
            matchedAfter: 0,
          }),
        };
      });
      let withLensBypassed: string;
      try {
        withLensBypassed = await renderReportRoute(multiProgramReport(), BASE_WIZARD_STATE, {
          persona: "all",
        });
      } finally {
        vi.doUnmock("@/lib/report-personas");
        vi.resetModules();
      }

      expect(withLensBypassed).toBe(withRealLens);
    });
  });
});
});
