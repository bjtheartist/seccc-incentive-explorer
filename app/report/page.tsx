"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Suspense,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Search,
  MapPin,
  FileText,
  Loader2,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import {
  REPORT_TYPE_OPTIONS,
  WIZARD_STEPS,
  getStepsForReportType,
  getStepIndex,
  getStepValue,
  setStepValue,
  INITIAL_WIZARD_STATE,
  PROJECT_TYPE_LABELS,
  PROPOSED_USE_LABELS,
  PROPOSED_USE_OPTIONS,
  VACANCY_PROJECT_TYPE_OPTIONS,
  FUNDING_COMMITTED_OPTIONS,
  REMAINING_GAP_OPTIONS,
  TIMELINE_OPTIONS,
  SITE_CONTROL_OPTIONS,
  JOBS_IMPACT_OPTIONS,
  SUPPORT_NEEDED_OPTIONS,
  BUDGET_RANGE_OPTIONS,
  optionLabel,
  projectGoalsAreComplete,
  selectedProjectGoalLabels,
  selectedProjectGoals,
} from "@/lib/report-wizard-config";
import type {
  ReportType,
  WizardState,
  WizardStepConfig,
} from "@/lib/report-wizard-config";
import { resolveGatePrepareGoals } from "@/lib/gate-goal-groups";
import type {
  GeneratedReport,
  ReportCensusData,
  ReportContext,
  ReportZoningData,
  CorridorMetric,
  CorridorOwnerCluster,
  NeighborhoodEconomicContext,
} from "@/lib/report-engine";
/**
 * review6 S11 (CRITICAL, S1 reopened) — replaces every direct
 * `generateReportData(state, programs, ctx)` call in this file.
 * `generateReportData()` used to run client-side against the full
 * internal catalog fetched from the now-removed
 * /api/programs/engine-source route (an unauthenticated endpoint
 * returning all 71 full internal Program records). Report generation now
 * runs server-side (POST /api/report/generate) — `state`/`ctx` are
 * already client-side, non-catalog data (zones, census, parcel,
 * districts, site signals, etc.), so nothing sensitive crosses the
 * network in the REQUEST either; only the already-safe `GeneratedReport`
 * comes back.
 */
async function generateReportRemote(
  state: WizardState,
  ctx: ReportContext,
): Promise<GeneratedReport> {
  const res = await fetch("/api/report/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, ctx }),
  });
  if (!res.ok) {
    throw new Error(`generateReportRemote: /api/report/generate returned ${res.status}`);
  }
  return (await res.json()) as GeneratedReport;
}
import { ReportDisplay } from "@/components/report/ReportDisplay";
import {
  GEOCODE_NOT_FOUND_MESSAGE,
  REPORT_GENERATION_FAILURE_COPY,
  geocodeFailureMessage,
  type ReportGenerationFailureSource,
} from "@/components/report/report-generation-failure";
import type { QuickRefineFields } from "@/components/report/RefineValuePanel";
import {
  DEFAULT_PERSONA,
  resolveInitialPersona,
  storePersona,
  type PersonaId,
} from "@/lib/personas";
import { derivePersonaLensVisible } from "@/lib/workspace";
import { ReportEmailGate } from "@/components/report/ReportEmailGate";
import { ProjectGoalSelector } from "@/components/report/ProjectGoalSelector";
import { InlineCrossLinkBanner } from "@/components/report/CrossLinkBanner";
import { isSupportOrganizationSectionTitle } from "@/lib/support-organization-copy";
import { ConciergePageContextBridge } from "@/components/concierge/SiteConciergeProvider";
import { reportEmailGateKey, reportRequiresEmailGate } from "@/lib/report-email";
import { decodeWizardState } from "@/lib/url-state";
import { normalizeZoneEvidenceV2 } from "@/lib/zone-response";
import {
  INSTANT_MODE_COORDINATE_ERROR_MESSAGE,
  isValidInstantCoordinatePair,
  parseInstantCoordinateParam,
  resolveInstantWizardCoordinateSeed,
} from "@/lib/instant-report-coords";
import {
  extractChicagoZipCode,
  mergeCommunityAnchorsIntoNeighborhoodEconomics,
  mergeTifFinanceIntoNeighborhoodEconomics,
} from "@/lib/neighborhood-economic-context";
import type { LocalBusinessSupportContext } from "@/lib/local-business-support";
import type { CommunityAnchor } from "@/lib/neighborhood-economic-models";
import type { TifFinanceContext } from "@/lib/tif-finance";
import { getSiteSignals } from "@/lib/site-signals";
import type { SiteSignals } from "@/lib/site-signals";
import { getTransportAccess } from "@/lib/transport-access";
import type { TransportAccess } from "@/lib/transport-access";
import type { MobilityAccess } from "@/lib/mobility-access";
import type {
  ParcelData,
  DistrictData,
  StackingRule,
  CommunityAsset,
  Stats,
} from "@/lib/types";
import { cachedFetch } from "@/lib/fetch-cache";
import { fetchZoningLookup, zoningLookupKey } from "@/lib/zoning-lookup";
import { trackEvent } from "@/lib/analytics-events";
import {
  createGeneratedReportEventGate,
  generatedReportEventKey,
  generatedReportEventType,
  reportAnalyticsPayload,
} from "@/lib/report-generated-event";
// ─── Animation Variants ──────────────────────────────────────────────

const stepVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 60 : -60,
  }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -60 : 60,
  }),
};

const stepTransition = { duration: 0.35, ease: "easeOut" as const };

// `fadeIn` moved out with the report renderer — components/report/ReportDisplay.tsx
// owns the only copy now.

const ALLOWED_REPORT_SOURCES = new Set([
  "homepage",
  "seo_cta",
  "start_page",
  "demo-homepage",
  "map",
  "neighborhood_page",
  "chrome_extension",
  "chrome-extension",
  // Added 2026-07 (report-workflow audit EF3/EF7): these were previously
  // dropped by cleanReportSource and silently collapsed into the generic
  // instant_report/report_wizard buckets, hiding which entry point a
  // snapshot/report actually came from.
  "address_search",
  "homepage_repeat",
  "locate",
  "workspace",
  "map_inline_card",
  "login",
  // The first-visit tour's sample report: previously collapsed into
  // instant_report, which hid tour attribution and defeated the tour's
  // email-gate suppression.
  "welcome_tour",
  // The Site Shortlist's per-card "Incentive snapshot" action. Unregistered,
  // every snapshot launched from a shortlist card would collapse into the
  // generic instant_report bucket and the shortlist would look like it drove
  // no reports at all. Keep in sync with SHORTLIST_SNAPSHOT_SOURCE in
  // lib/site-shortlist.ts.
  "site_shortlist",
  // The Brief's own "view the full living report" backlink (spec v2 item
  // 5) — a reader arriving at the full report from a forwarded Brief.
  "brief",
]);

function cleanReportSource(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.toLowerCase().trim().slice(0, 80);
  return ALLOWED_REPORT_SOURCES.has(cleaned) ? cleaned.replace(/-/g, "_") : null;
}

function supportOrganizationCount(report: GeneratedReport) {
  const supportSection = report.sections?.find(
    (section) => isSupportOrganizationSectionTitle(section.title),
  );
  if (!supportSection) return 0;
  return supportSection.items.slice(1).length;
}

async function fetchNeighborhoodEconomicsForZip(
  zip: string,
  signal?: AbortSignal
): Promise<NeighborhoodEconomicContext | null> {
  const res = await fetch(`/api/neighborhood-economics?zip=${encodeURIComponent(zip)}`, {
    cache: "default",
    signal,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    neighborhoodEconomics?: NeighborhoodEconomicContext | null;
  };
  return data.neighborhoodEconomics ?? null;
}

async function fetchCommunityAnchors(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<{ communityArea: string | null; anchors: CommunityAnchor[] } | null> {
  const res = await fetch(`/api/neighborhood-anchors?lat=${lat}&lon=${lon}`, {
    cache: "default",
    signal,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { communityArea?: string | null; anchors?: CommunityAnchor[] };
  return { communityArea: data.communityArea ?? null, anchors: data.anchors ?? [] };
}

async function fetchTifFinance(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<TifFinanceContext | null> {
  const res = await fetch(`/api/tif-finance?lat=${lat}&lon=${lon}`, {
    cache: "default",
    signal,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { tifFinance?: TifFinanceContext | null };
  return data.tifFinance ?? null;
}

/**
 * Identity of a local-support request. The ranked list depends on the project
 * context (e.g. SSA providers lead for storefront remodels), so a report
 * refined with a goal set at the email gate must refetch rather than reuse
 * the goal-less instant-report result.
 */
function localSupportRequestKey(
  state: Pick<WizardState, "lat" | "lon" | "reportType" | "projectGoals" | "projectType" | "proposedUse">,
): string {
  return [state.lat, state.lon, state.reportType, selectedProjectGoals(state).join(","), state.proposedUse]
    .map((value) => value ?? "")
    .join("|");
}

async function fetchLocalBusinessSupport(
  lat: number,
  lon: number,
  state: Pick<WizardState, "reportType" | "projectGoals" | "projectType" | "proposedUse">,
  signal?: AbortSignal
): Promise<LocalBusinessSupportContext | null> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (state.reportType) params.set("reportType", state.reportType);
  if (state.projectType) params.set("projectType", state.projectType);
  const projectGoals = selectedProjectGoals(state);
  if (projectGoals.length > 0) params.set("projectTypes", projectGoals.join(","));
  if (state.proposedUse) params.set("proposedUse", state.proposedUse);
  const res = await fetch(`/api/local-business-support?${params.toString()}`, {
    cache: "default",
    signal,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as LocalBusinessSupportContext;
  return data.organizations?.length ? data : null;
}

/**
 * Fetch ZIP economic context + community-area anchors and merge them, so the
 * report carries named anchor businesses and TIF district finance context
 * alongside the aggregate signals.
 */
async function fetchEconomicsWithAnchors(
  zip: string | null,
  lat: number | null | undefined,
  lon: number | null | undefined,
  signal?: AbortSignal
): Promise<NeighborhoodEconomicContext | null> {
  // Anchors only need lat/lon (community area), so they attach even when no ZIP
  // economic artifact covers the address. TIF finance also only needs lat/lon.
  const [economics, anchorData, tifFinance] = await Promise.all([
    zip ? fetchNeighborhoodEconomicsForZip(zip, signal) : Promise.resolve(null),
    lat != null && lon != null ? fetchCommunityAnchors(lat, lon, signal) : Promise.resolve(null),
    lat != null && lon != null ? fetchTifFinance(lat, lon, signal) : Promise.resolve(null),
  ]);
  const withAnchors = mergeCommunityAnchorsIntoNeighborhoodEconomics(
    economics,
    anchorData?.anchors,
    anchorData?.communityArea
  );
  return mergeTifFinanceIntoNeighborhoodEconomics(withAnchors, tifFinance);
}

function resolveReportZipFromContext(
  state: WizardState,
  context: {
    addressInput?: string | null;
    geocodeLabel?: string | null;
    parcel?: ParcelData | null;
  }
): string | null {
  return extractChicagoZipCode(
    state.neighborhood,
    context.parcel?.zip,
    context.parcel?.address,
    state.address,
    context.geocodeLabel,
    context.addressInput
  );
}

function getDisplayValueForStep(
  wizardState: WizardState,
  step: WizardStepConfig
): string {
  if (step.inputType === "project-intake") {
    const isVacancy = wizardState.reportType === "dev-feasibility";
    return (isVacancy
      ? [
        wizardState.projectType && (PROJECT_TYPE_LABELS[wizardState.projectType] || wizardState.projectType),
        wizardState.proposedUse && (PROPOSED_USE_LABELS[wizardState.proposedUse] || wizardState.proposedUse),
      ]
      : [
        selectedProjectGoalLabels(wizardState).join(", "),
        wizardState.budgetRange && optionLabel([...BUDGET_RANGE_OPTIONS, { id: "skip", label: "Still estimating" }], wizardState.budgetRange),
        wizardState.timeline && optionLabel(TIMELINE_OPTIONS, wizardState.timeline),
      ])
      .filter(Boolean)
      .join(" · ");
  }

  const val = step.inputType === "address"
    ? wizardState.address
    : getStepValue(wizardState, step.id);

  if (typeof val === "string") {
    if (
      (step.inputType === "single" || step.inputType === "combobox") &&
      step.options
    ) {
      const opt = step.options.find((o) => o.id === val);
      return opt?.label || val;
    }
    return val;
  }

  if (Array.isArray(val)) {
    if (step.options) {
      return val
        .map((v) => {
          const opt = step.options!.find((o) => o.id === v);
          return opt?.label || v;
        })
        .join(", ");
    }
    return val.join(", ");
  }

  return "";
}

function getWizardSelectionItems(
  wizardState: WizardState,
  steps: WizardStepConfig[]
): { label: string; value: string }[] {
  const items: { label: string; value: string }[] = [];
  const reportTypeOption = REPORT_TYPE_OPTIONS.find(
    (option) => option.id === wizardState.reportType
  );

  if (reportTypeOption) {
    items.push({ label: "Report", value: reportTypeOption.title });
  }

  for (const step of steps) {
    if (step.inputType === "report-type" || step.inputType === "review") {
      continue;
    }
    const value = getDisplayValueForStep(wizardState, step);
    if (value) items.push({ label: step.title, value });
  }

  return items;
}

// ─── Wrapper with Suspense ───────────────────────────────────────────

export default function ReportPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
          <div className="text-center">
            <div className="flex gap-1.5 justify-center mb-3">
              <div className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse" />
              <div className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
              <div className="w-2 h-2 bg-[#2563EB]/30 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
            </div>
            <p className="font-mono-bureau text-[11px] tracking-wide text-[#0C1B33]/30">Loading...</p>
          </div>
        </div>
      }
    >
      <ReportWizardPage />
    </Suspense>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────

function ReportWizardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Instant mode detection
  const requestedInstantMode = searchParams.get("instant") === "true";
  const instantLat = parseInstantCoordinateParam(searchParams.get("lat"));
  const instantLon = parseInstantCoordinateParam(searchParams.get("lon"));
  // review5 S9: missing, malformed (NaN), out-of-range, or partial
  // coordinates must never be allowed to enter instant mode's effect
  // chain (parcel/zoning/support/signals/transport/mobility all gate the
  // report-generation effect on wizardState.lat/lon) — one of those
  // effects never resolving for a bogus point would hang "Generating
  // Location Snapshot" forever with no error and no way out. See
  // lib/instant-report-coords.ts for the full rationale and the pure,
  // independently-tested validator.
  const hasValidInstantCoords = isValidInstantCoordinatePair(instantLat, instantLon);
  const isInstantMode = requestedInstantMode && hasValidInstantCoords;
  const instantModeCoordinateError =
    requestedInstantMode && !hasValidInstantCoords ? INSTANT_MODE_COORDINATE_ERROR_MESSAGE : null;
  const urlAddress = searchParams.get("addr") || "";
  // review6 S13 (HIGH): a refine link with `refine=true` used to check
  // only `instantLat != null && instantLon != null` — never the full
  // `isValidInstantCoordinatePair` predicate instant mode gets. An
  // out-of-range or otherwise malformed refine coordinate (e.g.
  // `?refine=true&lat=999&lon=999`) sailed straight through as "valid"
  // and into wizardState.lat/lon. `requestedRefineMode`/
  // `refineModeCoordinateError` below mirror `requestedInstantMode`/
  // `instantModeCoordinateError` exactly, so a bad refine link now gets
  // the identical fallback: address entry with an explanatory error,
  // never a bogus coordinate silently accepted.
  const requestedRefineMode = searchParams.get("refine") === "true" && !isInstantMode;
  const refineModeCoordinateError =
    requestedRefineMode && !hasValidInstantCoords ? INSTANT_MODE_COORDINATE_ERROR_MESSAGE : null;
  const instantAddr = urlAddress;
  // Landing page that launched this snapshot (set by AddressSearch / SEO CTAs).
  const instantSrc = searchParams.get("src") || "";
  // QR/campaign attribution parsed on /start and threaded through AddressSearch;
  // carried into the terminal event metadata so it isn't dropped before it
  // reaches a conversion event (EF5).
  const campaignParam = searchParams.get("campaign") || null;
  const corridorParam = searchParams.get("corridor") || "";
  const corridorPreviewKey = searchParams.get("preview") || "";
  const isCorridorPreview = corridorPreviewKey === "corridor-poc";
  const isCorridorMode = Boolean(corridorParam && isCorridorPreview);
  // Refine entry: a saved snapshot (Workspace) re-entering the refine flow
  // with its address preserved (audit RF1).
  // review6 S13: now gated on the SAME strict `hasValidInstantCoords`
  // predicate as instant mode (finite + in-range, not just non-null) —
  // see requestedRefineMode/refineModeCoordinateError above.
  const isRefineEntry = requestedRefineMode && hasValidInstantCoords;

  // Try to hydrate wizard state from URL params.
  // Legacy Corridor Intelligence share links remain decodable after the type
  // was retired from the public picker, so old recipient links do not break.
  const urlWizardState = useMemo(() => decodeWizardState(searchParams), [searchParams]);
  const shareWizardState = urlWizardState;
  const isShareMode = !!shareWizardState?.reportType && !isInstantMode;
  const reportSource = useMemo(() => {
    return (
      cleanReportSource(searchParams.get("source")) ||
      cleanReportSource(searchParams.get("src")) ||
      (isInstantMode
        ? "instant_report"
        : isShareMode
          ? "shared_report"
          : isCorridorMode
            ? "corridor_preview"
            : "report_wizard")
    );
  }, [isCorridorMode, isInstantMode, isShareMode, searchParams]);

  // Wizard state
  const [wizardState, setWizardState] = useState<WizardState>(() => {
    if (shareWizardState && !isInstantMode) {
      return shareWizardState;
    }
    // review6 S13: was `instantLat && instantLon` in each of the two
    // branches below (independently) — a truthy check that silently
    // REJECTS a validated (0, 0) pair (0 is falsy in JS), even though
    // `isInstantMode`/`isRefineEntry` being true already proves
    // `isValidInstantCoordinatePair(instantLat, instantLon)` passed. Both
    // branches now call the SAME extracted, independently-tested
    // resolver (`resolveInstantWizardCoordinateSeed`, `!= null` not
    // `&&`) instead of duplicating the null-check, so they can never
    // re-diverge on this again — see that function's own doc comment.
    const instantCoordinateSeed = resolveInstantWizardCoordinateSeed(instantAddr, instantLat, instantLon);
    if (isInstantMode && instantCoordinateSeed) {
      return { ...INITIAL_WIZARD_STATE, ...instantCoordinateSeed };
    }
    if (isCorridorMode) {
      return {
        ...INITIAL_WIZARD_STATE,
        reportType: "corridor-intelligence",
        neighborhood: corridorParam,
      };
    }
    if (isRefineEntry && instantCoordinateSeed) {
      return { ...INITIAL_WIZARD_STATE, ...instantCoordinateSeed };
    }
    if (urlAddress) {
      return {
        ...INITIAL_WIZARD_STATE,
        address: urlAddress,
        lat: instantLat,
        lon: instantLon,
      };
    }
    return INITIAL_WIZARD_STATE;
  });
  // Refine entries skip straight to the first refine screen (si-industry) —
  // the address is already known, so re-asking it is pure friction.
  const [currentStepIndex, setCurrentStepIndex] = useState(() =>
    isRefineEntry ? Math.max(getStepIndex("site-incentives", "si-industry"), 1) : 0
  );
  const [direction, setDirection] = useState(1);

  // Report state
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasRefinedInstantReport, setHasRefinedInstantReport] = useState(isRefineEntry);
  const [revealedReportKey, setRevealedReportKey] = useState<string | null>(null);
  // ── Persona lens (Tier 1b, audit BM4) — lifted here from ReportDisplay
  // (gate-persona-lens-sunset round) ──
  // `ReportDisplay` used to own this as local state, but `ReportEmailGate`
  // is rendered as its SIBLING here, not its child — the gate's own
  // `commitPersonaSelection` could only ever write to sessionStorage
  // (`storePersona`), which `ReportDisplay`'s mount-time effect had already
  // read-and-discarded before the gate ever closed. A visitor who answered
  // "Business owner" in the gate got a report rendered with
  // `DEFAULT_PERSONA` regardless — the flat "All" structure, no guidepost
  // PART bands (`guidepostPartForSection` returns null for
  // `DEFAULT_PERSONA`). Owning the state here lets BOTH `ReportDisplay`
  // (as a controlled `persona`/`onPersonaSelect` prop pair — see its own
  // signature below) and `ReportEmailGate` (via `onPersonaCommitted`,
  // wired below) read and write the SAME value. See
  // report-page-live-renderer.test.tsx's ordinal-`useState` maintenance
  // warning: this slot moved from `ReportDisplay`'s state order into this
  // component's, in the same commit as this change.
  const [persona, setPersona] = useState<PersonaId>(DEFAULT_PERSONA);
  useEffect(() => {
    setPersona(
      resolveInitialPersona(
        typeof window !== "undefined" ? window.location.search : null,
      ),
    );
  }, []);
  const handlePersonaSelect = useCallback((next: PersonaId) => {
    setPersona(next);
    storePersona(next);
  }, []);
  const generatedReportEventGateRef = useRef(createGeneratedReportEventGate());

  // Comparison state
  const [compareMode, setCompareMode] = useState(false);
  const [compareReport, setCompareReport] = useState<GeneratedReport | null>(null);
  const [compareAddressInput, setCompareAddressInput] = useState("");
  const [compareGeocoding, setCompareGeocoding] = useState(false);
  const [compareGeoResult, setCompareGeoResult] = useState<{ lat: number; lon: number; display_name: string } | null>(null);
  const [compareZones, setCompareZones] = useState<Record<string, boolean> | null>(null);
  const [compareZoneNames, setCompareZoneNames] = useState<Record<string, string> | null>(null);
  const [compareZoneUnknowns, setCompareZoneUnknowns] = useState<string[]>([]);
  const [compareCensus, setCompareCensus] = useState<ReportCensusData | null>(null);
  const [compareZoning, setCompareZoning] = useState<ReportZoningData | null>(null);
  const [compareZoningKey, setCompareZoningKey] = useState<string | null>(null);
  const [compareParcel, setCompareParcel] = useState<ParcelData | null>(null);
  const [compareNeighborhoodEconomics, setCompareNeighborhoodEconomics] = useState<NeighborhoodEconomicContext | null>(null);
  const [compareNeighborhoodEconomicsZip, setCompareNeighborhoodEconomicsZip] = useState<string | null>(null);

  // Data state
  // review6 S11 (CRITICAL, S1 reopened): the client-side `programs: Program[]`
  // state that used to live here (fetched from the now-removed
  // /api/programs/engine-source route) is gone — report generation is
  // server-side now (generateReportRemote() -> POST /api/report/generate),
  // so the client never needs the raw catalog at all.
  const [zones, setZones] = useState<Record<string, boolean> | null>(null);
  const [zoneNames, setZoneNames] = useState<Record<string, string> | null>(null);
  const [zoneUnknowns, setZoneUnknowns] = useState<string[]>([]);
  const [zoneCheckedAt, setZoneCheckedAt] = useState<string | null>(null);
  const [censusData, setCensusData] = useState<ReportCensusData | null>(null);
  const [cityZoning, setCityZoning] = useState<ReportZoningData | null>(null);
  const [cityZoningKey, setCityZoningKey] = useState<string | null>(null);
  const [parcelData, setParcelData] = useState<ParcelData | null>(null);
  const [parcelLookupComplete, setParcelLookupComplete] = useState(false);
  const [districtsData, setDistrictsData] = useState<DistrictData | null>(null);
  const [stackingRules, setStackingRules] = useState<StackingRule[] | null>(null);
  const [communityAssets, setCommunityAssets] = useState<CommunityAsset[] | null>(null);
  const [localBusinessSupport, setLocalBusinessSupport] = useState<LocalBusinessSupportContext | null | undefined>(undefined);
  const [siteSignals, setSiteSignals] = useState<SiteSignals | null | undefined>(undefined);
  const [transportAccess, setTransportAccess] = useState<TransportAccess | null | undefined>(undefined);
  const [mobilityAccess, setMobilityAccess] = useState<MobilityAccess | null | undefined>(undefined);
  const [areaStats, setAreaStats] = useState<Stats | null>(null);
  const [corridorMetric, setCorridorMetric] = useState<CorridorMetric | null>(null);
  const [corridorOwnerClusters, setCorridorOwnerClusters] = useState<CorridorOwnerCluster[]>([]);
  const [corridorLoading, setCorridorLoading] = useState(isCorridorMode);
  const [neighborhoodEconomics, setNeighborhoodEconomics] = useState<NeighborhoodEconomicContext | null>(null);
  const [neighborhoodEconomicsZip, setNeighborhoodEconomicsZip] = useState<string | null>(null);

  // Address / geocode state
  const [addressInput, setAddressInput] = useState(
    shareWizardState?.address || urlAddress
  );
  const [geocodeResult, setGeocodeResult] = useState<{
    lat: number;
    lon: number;
    display_name: string;
  } | null>(
    // review5 S9: was a raw `instantLat && instantLon` truthy check
    // (independent of isInstantMode) — an out-of-range or otherwise
    // invalid pair could still seed geocodeResult here even when instant
    // mode itself correctly declined to engage.
    hasValidInstantCoords && instantLat != null && instantLon != null && (shareWizardState?.address || urlAddress)
      ? { lat: instantLat, lon: instantLon, display_name: shareWizardState?.address || urlAddress }
      : null,
  );
  const [isGeocoding, setIsGeocoding] = useState(false);
  // review5 S9 / review6 S13: seeded from the coordinate-validation error
  // computed above, so an invalid instant-mode OR refine-mode link
  // surfaces an explanation in the SAME error UI the normal address-entry
  // flow already uses, instead of silently falling back with no feedback.
  // Exactly one of the two can be non-null at a time (requestedRefineMode
  // requires `!isInstantMode`), so there's no precedence question.
  const [geocodeError, setGeocodeError] = useState<string | null>(
    instantModeCoordinateError ?? refineModeCoordinateError,
  );

  // Instant mode state
  const [instantLoading, setInstantLoading] = useState(isInstantMode);

  // The ONLY emitter of the generated-report funnel events
  // (location_snapshot_generated / refined_report_generated /
  // vacancy_report_generated), gated by report identity so one generated
  // report fires exactly one event. The instant-mode generation effect must
  // not fire its own copy — that double-counted every instant snapshot.
  useEffect(() => {
    if (!report) return;
    if (
      reportRequiresEmailGate(report)
      && revealedReportKey !== reportEmailGateKey(report)
    ) return;
    const eventType = generatedReportEventType(
      report,
      isInstantMode,
      hasRefinedInstantReport,
    );
    const reportEventKey = generatedReportEventKey(report, eventType, reportSource);
    if (!generatedReportEventGateRef.current.shouldFire(reportEventKey)) return;

    trackEvent(
      eventType,
      reportAnalyticsPayload(report, reportSource, {
        entrySource: reportSource,
        isInstantMode,
        hasProjectDetails: !isInstantMode || hasRefinedInstantReport,
        supportOrganizationsSurfaced: supportOrganizationCount(report),
        // Landing page that launched an instant search (raw `src` URL param),
        // kept alongside the cleaned entrySource for attribution.
        ...(isInstantMode ? { landing_page: instantSrc || null } : {}),
        ...(campaignParam ? { campaign: campaignParam } : {}),
      }),
    );
  }, [campaignParam, hasRefinedInstantReport, instantSrc, isInstantMode, report, reportSource, revealedReportKey]);

  // ZIP parsed from address/parcel/geocode strings.
  const stringZip = useMemo(
    () =>
      resolveReportZipFromContext(wizardState, {
        addressInput,
        geocodeLabel: geocodeResult?.display_name,
        parcel: parcelData,
      }),
    [addressInput, geocodeResult?.display_name, parcelData, wizardState]
  );

  // Fallback: reverse-geocode lat/lon -> ZIP when the address string has none
  // (e.g. parcel records with a 00000 ZIP). Lets ZIP economic context attach.
  const [reverseZip, setReverseZip] = useState<string | null>(null);
  useEffect(() => {
    if (stringZip) return;
    const lat = wizardState.lat;
    const lon = wizardState.lon;
    if (lat == null || lon == null) {
      setReverseZip(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/geocode?lat=${lat}&lon=${lon}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (controller.signal.aborted) return;
        const zip = d?.zip ? extractChicagoZipCode(String(d.zip)) : null;
        setReverseZip(zip);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [stringZip, wizardState.lat, wizardState.lon]);

  const reportZip = stringZip ?? reverseZip;

  const compareZip = useMemo(
    () =>
      extractChicagoZipCode(
        compareParcel?.zip,
        compareParcel?.address,
        compareGeoResult?.display_name,
        compareAddressInput
      ),
    [compareAddressInput, compareGeoResult?.display_name, compareParcel?.address, compareParcel?.zip]
  );

  // review6 S11 (CRITICAL, S1 reopened): the "load programs on mount"
  // effect that used to live here is gone. Report generation
  // (generateReportRemote() -> POST /api/report/generate) and the map's
  // confidence-engine matching (now server-side too) no longer need the
  // client to hold the full catalog at all.

  // review7 S18 (HIGH): the coordinate-dependent effects below (and the
  // instant/share auto-generation gates further down) used to each
  // independently write `wizardState.lat && wizardState.lon` — a truthy
  // check that treats a validated (0, 0) pair (S13 seeds it correctly
  // into wizardState) as "no coordinates," even though `0` is a
  // perfectly real, in-range value `isValidInstantCoordinatePair`
  // accepts. That silently skipped every lat/lon-dependent fetch for
  // (0, 0) — the zone effect cleared `zones` to `null` and never
  // re-fetched it, so the instant-mode generation gate's `if (!zones)
  // return;` waited on a value that could never become non-null again,
  // hanging "Generating Location Snapshot" forever. One shared,
  // correctly-null-checked boolean, reused everywhere below, so this
  // class of bug can't recur one effect at a time.
  const hasWizardCoords = wizardState.lat != null && wizardState.lon != null;

  // Load zone data when address has lat/lon
  // Uses the API first, then falls back to client-side Turf.js if the API fails.
  useEffect(() => {
    // review7 S18: kept as an inline `== null` check (not the shared
    // `hasWizardCoords` boolean) specifically so TypeScript narrows
    // `wizardState.lat`/`.lon` to `number` for the `const lat`/`lon`
    // declarations right below — `checkZones(lat, lon)` further down
    // requires `number`, and narrowing through a separately-computed
    // boolean variable doesn't propagate that far. Same `!= null`
    // semantics as `hasWizardCoords` everywhere else in this file.
    const lat = wizardState.lat;
    const lon = wizardState.lon;
    if (lat == null || lon == null) {
      setZones(null);
      setZoneNames(null);
      setZoneUnknowns([]);
      setZoneCheckedAt(null);
      return;
    }
    let cancelled = false;
    setZones(null);
    setZoneNames(null);
    setZoneUnknowns([]);
    setZoneCheckedAt(null);

    (async () => {
      try {
        // build-spec.md 2.3 / audit F2: v2's tri-state layers let a genuine
        // "not matched" be told apart from "could not be checked" — v1's
        // positives-only array cannot make that distinction. Raw fetch, not
        // cachedFetch: the shared client cache ignores the route's own
        // Cache-Control and has stale-on-error fallback (consult item 5) —
        // exactly the "serve stale evidence for a negative claim" risk this
        // cutover exists to close. The v2 route and its Redis layer already
        // cap TTL correctly server-side.
        const zoneRes = await fetch(`/api/zones/check/v2?lat=${lat}&lon=${lon}`);
        if (!zoneRes.ok) throw new Error("API unavailable");
        const data = await zoneRes.json();
        const evidence = normalizeZoneEvidenceV2(data);
        if (!evidence) throw new Error("API unavailable");
        if (cancelled) return;
        const mapped: Record<string, boolean> = {};
        const names: Record<string, string> = {};
        for (const [key, entry] of Object.entries(evidence.layers)) {
          mapped[key] = entry.state === "matched";
          if (entry.name) names[key] = entry.name;
        }
        setZones(mapped);
        setZoneNames(names);
        setZoneUnknowns(evidence.unknownKeys);
        setZoneCheckedAt(evidence.checkedAt.slice(0, 10));
      } catch {
        // Fallback: use client-side Turf.js zone check
        const { checkZones } = await import("@/lib/zone-check");
        const result = await checkZones(lat, lon);
        if (cancelled) return;
        setZones(result.zones);
        setZoneNames(result.zoneNames);
        setZoneUnknowns(result.unknownZones ?? []);
        setZoneCheckedAt(new Date().toISOString().slice(0, 10));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wizardState.lat, wizardState.lon]);

  // Load census + parcel data when address has lat/lon.
  useEffect(() => {
    if (!hasWizardCoords) return;
    setParcelLookupComplete(false);
    setParcelData(null);
    cachedFetch(`/api/census?lat=${wizardState.lat}&lon=${wizardState.lon}`)
      .then((data) => { if (data) setCensusData(data as ReportCensusData); })
      .catch(() => {});
    // Pass the searched address so /api/parcel can verify the resolved
    // parcel's County-published address instead of trusting the geocoded
    // point (which can sit in the street right-of-way or a larger,
    // differently addressed parcel).
    const parcelAddressParam = wizardState.address
      ? `&address=${encodeURIComponent(wizardState.address)}`
      : "";
    cachedFetch<ParcelData>(
      `/api/parcel?lat=${wizardState.lat}&lon=${wizardState.lon}${parcelAddressParam}`,
    )
      .then((data) => { if (data) setParcelData(data); })
      .catch(() => {})
      .finally(() => setParcelLookupComplete(true));
    cachedFetch<DistrictData>(`/api/representatives?lat=${wizardState.lat}&lon=${wizardState.lon}`)
      .then((data) => { if (data) setDistrictsData(data); })
      .catch(() => {});
  }, [wizardState.lat, wizardState.lon, wizardState.address, hasWizardCoords]);

  // Zoning has a stricter contract than the general stale-while-error client
  // cache: never reuse another address or hide a current source failure.
  useEffect(() => {
    const lat = wizardState.lat;
    const lon = wizardState.lon;
    if (lat == null || lon == null) {
      setCityZoning(null);
      setCityZoningKey(null);
      return;
    }

    const requestKey = zoningLookupKey(lat, lon);
    const controller = new AbortController();
    setCityZoning(null);
    setCityZoningKey(null);

    fetchZoningLookup(lat, lon, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setCityZoning(result);
      setCityZoningKey(requestKey);
    });

    return () => controller.abort();
  }, [wizardState.lat, wizardState.lon]);

  // Load address-level proximity signals used in the report Site Overview.
  useEffect(() => {
    // review7 S18: same narrowing reason as the zone-data effect above —
    // getSiteSignals/getTransportAccess require `number`, not
    // `number | null`.
    const lat = wizardState.lat;
    const lon = wizardState.lon;
    if (lat == null || lon == null) {
      setSiteSignals(undefined);
      setTransportAccess(undefined);
      setMobilityAccess(undefined);
      return;
    }

    setSiteSignals(undefined);
    setTransportAccess(undefined);
    setMobilityAccess(undefined);

    getSiteSignals(lat, lon)
      .then((signals) => setSiteSignals(signals))
      .catch(() => setSiteSignals(null));
    getTransportAccess(lat, lon)
      .then((transport) => setTransportAccess(transport))
      .catch(() => setTransportAccess(null));
    cachedFetch<MobilityAccess>(`/api/mobility-access?lat=${lat}&lon=${lon}`)
      .then((mobility) => setMobilityAccess(mobility))
      .catch(() => setMobilityAccess(null));
  }, [wizardState.lat, wizardState.lon]);

  // Load stacking rules + community assets when address has lat/lon
  const localSupportKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasWizardCoords) {
      setLocalBusinessSupport(undefined);
      localSupportKeyRef.current = null;
      return;
    }
    cachedFetch<StackingRule[]>("/api/stacking").then((d) => { if (d) setStackingRules(d); }).catch(() => {});
    cachedFetch<CommunityAsset[]>(`/api/assets?type=edo,bso`).then((d) => { if (d) setCommunityAssets(d); }).catch(() => {});
    setLocalBusinessSupport(undefined);
    const params = new URLSearchParams({
      lat: String(wizardState.lat),
      lon: String(wizardState.lon),
    });
    if (wizardState.reportType) params.set("reportType", wizardState.reportType);
    if (wizardState.projectType) params.set("projectType", wizardState.projectType);
    const projectGoals = selectedProjectGoals({
      projectGoals: wizardState.projectGoals,
      projectType: wizardState.projectType,
    });
    if (projectGoals.length > 0) params.set("projectTypes", projectGoals.join(","));
    if (wizardState.proposedUse) params.set("proposedUse", wizardState.proposedUse);
    localSupportKeyRef.current = localSupportRequestKey({
      lat: wizardState.lat,
      lon: wizardState.lon,
      reportType: wizardState.reportType,
      projectGoals: wizardState.projectGoals,
      projectType: wizardState.projectType,
      proposedUse: wizardState.proposedUse,
    });
    cachedFetch<LocalBusinessSupportContext>(`/api/local-business-support?${params.toString()}`)
      .then((d) => setLocalBusinessSupport(d?.organizations?.length ? d : null))
      .catch(() => setLocalBusinessSupport(null));
  }, [
    wizardState.lat,
    wizardState.lon,
    wizardState.projectGoals,
    wizardState.projectType,
    wizardState.proposedUse,
    wizardState.reportType,
    hasWizardCoords,
  ]);

  // Load area stats on mount (no lat/lon dependency)
  useEffect(() => {
    cachedFetch<Stats>("/api/stats").then((d) => { if (d) setAreaStats(d); }).catch(() => {
      cachedFetch<Stats>("/data/stats.json").then((d) => { if (d) setAreaStats(d); }).catch(() => {});
    });
  }, []);

  // Load aggregate ZIP economic context (when a ZIP resolves) + community-area
  // anchors (whenever lat/lon resolve, independent of ZIP).
  useEffect(() => {
    const lat = wizardState.lat;
    const lon = wizardState.lon;
    const hasLatLon = lat != null && lon != null;
    if (!reportZip && !hasLatLon) {
      setNeighborhoodEconomics(null);
      setNeighborhoodEconomicsZip(null);
      return;
    }

    const controller = new AbortController();
    setNeighborhoodEconomics(null);
    setNeighborhoodEconomicsZip(null);

    fetchEconomicsWithAnchors(reportZip, lat, lon, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setNeighborhoodEconomics(data);
        setNeighborhoodEconomicsZip(reportZip);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setNeighborhoodEconomics(null);
          setNeighborhoodEconomicsZip(reportZip);
        }
      });

    return () => controller.abort();
  }, [reportZip, wizardState.lat, wizardState.lon]);

  // Load corridor intelligence metrics when the report is corridor-based.
  useEffect(() => {
    if (wizardState.reportType !== "corridor-intelligence" || !wizardState.neighborhood) {
      setCorridorMetric(null);
      setCorridorOwnerClusters([]);
      setCorridorLoading(false);
      return;
    }

    const controller = new AbortController();
    setCorridorLoading(true);
    Promise.all([
      fetch(
        `/api/corridor?zip=${encodeURIComponent(wizardState.neighborhood)}&_=${Date.now()}`,
        { cache: "no-store", signal: controller.signal }
      ).then((res) => (res.ok ? res.json() : null) as Promise<{ corridors?: CorridorMetric[] } | null>),
      fetch(
        `/api/corridor/owners?zip=${encodeURIComponent(wizardState.neighborhood)}&limit=50&_=${Date.now()}`,
        { cache: "no-store", signal: controller.signal }
      ).then((res) => (res.ok ? res.json() : null) as Promise<{ clusters?: CorridorOwnerCluster[] } | null>),
    ])
      .then(([metricData, ownerData]) => {
        if (controller.signal.aborted) return;
        setCorridorMetric(metricData?.corridors?.[0] ?? null);
        setCorridorOwnerClusters(ownerData?.clusters ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCorridorMetric(null);
          setCorridorOwnerClusters([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCorridorLoading(false);
      });

    return () => controller.abort();
  }, [wizardState.neighborhood, wizardState.reportType]);

  // ── Comparison data fetching ──
  useEffect(() => {
    if (!compareGeoResult) return;
    const { lat, lon } = compareGeoResult;
    const requestKey = zoningLookupKey(lat, lon);
    const zoningController = new AbortController();
    setCompareZones(null);
    setCompareZoneNames(null);
    setCompareZoneUnknowns([]);
    setCompareCensus(null);
    setCompareZoning(null);
    setCompareZoningKey(null);
    setCompareParcel(null);
    (async () => {
      try {
        // Raw fetch, not cachedFetch — see the primary zone-fetch effect's
        // comment above for why (consult item 5: stale-on-error must never
        // serve as evidence for a negative claim).
        const compareZoneRes = await fetch(`/api/zones/check/v2?lat=${lat}&lon=${lon}`);
        if (!compareZoneRes.ok) throw new Error("API unavailable");
        const data = await compareZoneRes.json();
        const evidence = normalizeZoneEvidenceV2(data);
        if (!evidence) throw new Error("API unavailable");
        const mapped: Record<string, boolean> = {};
        const names: Record<string, string> = {};
        for (const [key, entry] of Object.entries(evidence.layers)) {
          mapped[key] = entry.state === "matched";
          if (entry.name) names[key] = entry.name;
        }
        setCompareZones(mapped);
        setCompareZoneNames(names);
        setCompareZoneUnknowns(evidence.unknownKeys);
      } catch {
        const { checkZones } = await import("@/lib/zone-check");
        const result = await checkZones(lat, lon);
        setCompareZones(result.zones);
        setCompareZoneNames(result.zoneNames);
        setCompareZoneUnknowns(result.unknownZones ?? []);
      }
    })();
    cachedFetch(`/api/census?lat=${lat}&lon=${lon}`).then((d) => { if (d) setCompareCensus(d as ReportCensusData); }).catch(() => {});
    fetchZoningLookup(lat, lon, { signal: zoningController.signal }).then((result) => {
      if (zoningController.signal.aborted) return;
      setCompareZoning(result);
      setCompareZoningKey(requestKey);
    });
    const compareAddressParam = compareGeoResult.display_name
      ? `&address=${encodeURIComponent(compareGeoResult.display_name)}`
      : "";
    cachedFetch<ParcelData>(`/api/parcel?lat=${lat}&lon=${lon}${compareAddressParam}`).then((d) => { if (d) setCompareParcel(d); }).catch(() => {});
    return () => zoningController.abort();
  }, [compareGeoResult]);

  useEffect(() => {
    if (!compareZip) {
      setCompareNeighborhoodEconomics(null);
      setCompareNeighborhoodEconomicsZip(null);
      return;
    }

    const controller = new AbortController();
    setCompareNeighborhoodEconomics(null);
    setCompareNeighborhoodEconomicsZip(null);

    fetchNeighborhoodEconomicsForZip(compareZip, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setCompareNeighborhoodEconomics(data);
        setCompareNeighborhoodEconomicsZip(compareZip);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCompareNeighborhoodEconomics(null);
          setCompareNeighborhoodEconomicsZip(compareZip);
        }
      });

    return () => controller.abort();
  }, [compareZip]);

  // Generate comparison report once compare data is ready
  useEffect(() => {
    if (!compareGeoResult || !compareZones) return;
    if (
      compareZoningKey !==
      zoningLookupKey(compareGeoResult.lat, compareGeoResult.lon)
    ) return;
    if (compareZip && compareNeighborhoodEconomicsZip !== compareZip) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const compareState: WizardState = {
        ...wizardState,
        address: compareGeoResult.display_name,
        lat: compareGeoResult.lat,
        lon: compareGeoResult.lon,
      };
      setReportError(null);
      generateReportRemote(compareState, {
        zones: compareZones ?? undefined,
        zoneNames: compareZoneNames ?? undefined,
        unknownZones: compareZoneUnknowns,
        census: compareCensus ?? undefined,
        cityZoning: compareZoning ?? undefined,
        parcel: compareParcel ?? undefined,
        neighborhoodEconomics: compareNeighborhoodEconomics ?? undefined,
      })
        .then((generated) => {
          if (!cancelled) setCompareReport(generated);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("comparison report generation failed:", error);
          // R1 finding 1: previously log-and-swallow, so the compare panel sat
          // on "Generating comparison report..." indefinitely.
          setReportError("comparison");
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [compareGeoResult, compareZones, compareZoneNames, compareCensus, compareZoning, compareZoningKey, compareParcel, compareZip, compareNeighborhoodEconomicsZip, compareNeighborhoodEconomics, wizardState]);

  // Instant mode: auto-generate report once zones are loaded
  // Small delay gives census/zoning APIs time to resolve alongside zones
  useEffect(() => {
    if (!isInstantMode || !instantLoading) return;
    if (!zones) return;
    if (hasWizardCoords && !parcelLookupComplete) return;
    if (
      wizardState.lat != null &&
      wizardState.lon != null &&
      cityZoningKey !== zoningLookupKey(wizardState.lat, wizardState.lon)
    ) return;
    if (hasWizardCoords && localBusinessSupport === undefined) return;
    if (hasWizardCoords && siteSignals === undefined) return;
    if (hasWizardCoords && transportAccess === undefined) return;
    if (hasWizardCoords && mobilityAccess === undefined) return;
    if (reportZip && neighborhoodEconomicsZip !== reportZip) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsGenerating(true);
      // A fresh attempt clears the previous failure (R1 finding 1).
      setReportError(null);
      try {
        const generated = await generateReportRemote(wizardState, {
          zones: zones ?? undefined,
          zoneNames: zoneNames ?? undefined,
          unknownZones: zoneUnknowns,
          zoneCheckedAt: zoneCheckedAt ?? undefined,
          census: censusData ?? undefined,
          cityZoning: cityZoning ?? undefined,
          parcel: parcelData ?? undefined,
          reportZip: reportZip ?? undefined,
          districts: districtsData ?? undefined,
          stackingRules: stackingRules ?? undefined,
          communityAssets: communityAssets ?? undefined,
          localBusinessSupport: localBusinessSupport ?? undefined,
          stats: areaStats ?? undefined,
          neighborhoodEconomics: neighborhoodEconomics ?? undefined,
          siteSignals: siteSignals ?? undefined,
          transport: transportAccess ?? undefined,
          mobilityAccess: mobilityAccess ?? undefined,
        });
        if (cancelled) return;
        setReport(generated);
        // Funnel completion (location_snapshot_generated) is fired by the
        // generated-report effect above, gated by report identity — do not
        // trackEvent here or the snapshot double-counts.
      } catch (err) {
        if (cancelled) return;
        // R1 finding 1: this used to STAY ON LOADING deliberately — the
        // failure was visible to engineering (below) and to nobody else, and
        // the reader watched a spinner that would never finish. It now raises
        // an honest, retryable state.
        setReportError("instant");
        console.error("instant report generation failed:", err);
        trackEvent("report_generation_failed", {
          source: "instant",
          address: wizardState.address || instantAddr || null,
          lat: wizardState.lat,
          lon: wizardState.lon,
          metadata: {
            mode: "instant",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        if (!cancelled) {
          setIsGenerating(false);
          setInstantLoading(false);
        }
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isInstantMode, instantLoading, zones, zoneNames, censusData, cityZoning, cityZoningKey, parcelData, parcelLookupComplete, districtsData, stackingRules, communityAssets, localBusinessSupport, siteSignals, transportAccess, mobilityAccess, areaStats, reportZip, neighborhoodEconomicsZip, neighborhoodEconomics, wizardState, instantAddr, hasWizardCoords]);

  /**
   * R1 finding 1, follow-up — what actually makes "Try again" try again on the
   * corridor and shared-report paths.
   *
   * The retry handler used to re-arm those two by calling
   * `setCorridorAutoGenerated(false)` / `setShareAutoGenerated(false)`. Both
   * flags are only ever set to `true` on SUCCESS, so after a failure they are
   * already `false`: the "reset" wrote a state slot the value it already held,
   * React bailed out, no dep in either effect changed, and no second POST was
   * ever issued. The card simply unmounted and dropped the reader into a blank
   * wizard. (Instant mode escaped this only because `instantLoading` IS set on
   * the failure path, so flipping it back is a real transition.)
   *
   * A monotonic counter has no such fixed point — every click is a genuinely
   * new value — so carrying it in both effects' dep arrays re-runs the SAME
   * generation path with the SAME already-fetched inputs, which is what the
   * button has always claimed to do.
   *
   * ORDINAL PLACEMENT: this is a `useState`, so it is subject to the same
   * ordinal harness described at `reportError` below. It has to be declared
   * ABOVE the corridor effect that reads it (a dep array is evaluated on the
   * first render, so a later `const` would be a TDZ error), which means it
   * takes a slot in the MIDDLE of the run rather than the end. Its name is
   * inserted at the matching position in `REPORT_WIZARD_PAGE_STATE_ORDER` in
   * app/report/__tests__/report-page-live-renderer.test.tsx, which is what
   * keeps every later slot seeded with its own value.
   */
  const [retryNonce, setRetryNonce] = useState(0);

  // Corridor URL mode: auto-generate a corridor report after the metric lookup completes.
  const [corridorAutoGenerated, setCorridorAutoGenerated] = useState(false);
  useEffect(() => {
    if (!isCorridorMode || corridorAutoGenerated) return;
    if (corridorLoading) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsGenerating(true);
      // A fresh attempt clears the previous failure (R1 finding 1).
      setReportError(null);
      try {
        const generated = await generateReportRemote(wizardState, {
          corridorMetrics: corridorMetric ?? undefined,
          corridorOwnerClusters,
          reportZip: reportZip ?? undefined,
          stats: areaStats ?? undefined,
        });
        if (cancelled) return;
        setReport(generated);
        setCorridorAutoGenerated(true);
      } catch (err) {
        if (cancelled) return;
        setReportError("corridor");
        console.error("corridor report generation failed:", err);
        trackEvent("report_generation_failed", {
          source: "corridor",
          metadata: {
            mode: "corridor",
            neighborhood: wizardState.neighborhood || null,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        if (!cancelled) setIsGenerating(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isCorridorMode, corridorAutoGenerated, corridorLoading, corridorMetric, corridorOwnerClusters, reportZip, areaStats, wizardState, retryNonce]);

  // Share mode: auto-generate report once zones are loaded
  const [shareAutoGenerated, setShareAutoGenerated] = useState(false);

  /**
   * R1 finding 1 — the infinite spinner. Which generation path failed, or
   * null when nothing has. Every `generateReportRemote` catch block used to
   * log-and-swallow, leaving the reader on a spinner forever; this is what
   * turns that into an honest, retryable state.
   *
   * ORDINAL PLACEMENT (deliberate, do not move without reading this).
   * app/report/__tests__/report-page-live-renderer.test.tsx seeds React state
   * BY ORDINAL through a monkey-patched `useState`, against the two order
   * arrays REPORT_WIZARD_PAGE_STATE_ORDER + REPORT_DISPLAY_STATE_ORDER.
   * Declaring this slot LAST in `ReportWizardPage` — after
   * `shareAutoGenerated`, the final slot in that first array — is the minimum
   * possible churn: no existing slot's ordinal moves, and the fix is one
   * appended name plus one default value. The four effects above that call
   * `setReportError` are declared earlier in the file but only ever RUN after
   * render, so closing over this binding is safe.
   */
  const [reportError, setReportError] = useState<ReportGenerationFailureSource | null>(null);
  useEffect(() => {
    if (!isShareMode || shareAutoGenerated) return;
    // For address-based reports, wait for zones
    if (!zones && hasWizardCoords) return;
    if (hasWizardCoords && !parcelLookupComplete) return;
    if (
      wizardState.lat != null &&
      wizardState.lon != null &&
      cityZoningKey !== zoningLookupKey(wizardState.lat, wizardState.lon)
    ) return;
    if (hasWizardCoords && localBusinessSupport === undefined) return;
    if (hasWizardCoords && siteSignals === undefined) return;
    if (hasWizardCoords && transportAccess === undefined) return;
    if (hasWizardCoords && mobilityAccess === undefined) return;
    if (wizardState.reportType === "corridor-intelligence" && corridorLoading) return;
    if (reportZip && neighborhoodEconomicsZip !== reportZip) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsGenerating(true);
      // A fresh attempt clears the previous failure (R1 finding 1).
      setReportError(null);
      try {
        const generated = await generateReportRemote(wizardState, {
          zones: zones ?? undefined,
          zoneNames: zoneNames ?? undefined,
          unknownZones: zoneUnknowns,
          zoneCheckedAt: zoneCheckedAt ?? undefined,
          census: censusData ?? undefined,
          cityZoning: cityZoning ?? undefined,
          parcel: parcelData ?? undefined,
          reportZip: reportZip ?? undefined,
          districts: districtsData ?? undefined,
          stackingRules: stackingRules ?? undefined,
          communityAssets: communityAssets ?? undefined,
          localBusinessSupport: localBusinessSupport ?? undefined,
          stats: areaStats ?? undefined,
          corridorMetrics: corridorMetric ?? undefined,
          corridorOwnerClusters,
          neighborhoodEconomics: neighborhoodEconomics ?? undefined,
          siteSignals: siteSignals ?? undefined,
          transport: transportAccess ?? undefined,
          mobilityAccess: mobilityAccess ?? undefined,
        });
        if (cancelled) return;
        setReport(generated);
        setShareAutoGenerated(true);
      } catch (err) {
        if (cancelled) return;
        setReportError("shared_report");
        console.error("shared report generation failed:", err);
        trackEvent("report_generation_failed", {
          source: "shared_report",
          address: wizardState.address || null,
          lat: wizardState.lat,
          lon: wizardState.lon,
          metadata: {
            mode: "share",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        if (!cancelled) setIsGenerating(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isShareMode, shareAutoGenerated, zones, zoneNames, censusData, cityZoning, cityZoningKey, parcelData, parcelLookupComplete, districtsData, stackingRules, communityAssets, localBusinessSupport, siteSignals, transportAccess, mobilityAccess, areaStats, corridorLoading, corridorMetric, corridorOwnerClusters, reportZip, neighborhoodEconomicsZip, neighborhoodEconomics, wizardState, hasWizardCoords, retryNonce]);

  // Derive steps based on report type
  const steps = useMemo<WizardStepConfig[]>(() => {
    if (!wizardState.reportType) return [WIZARD_STEPS[0]]; // just the report-type step
    const baseSteps = getStepsForReportType(wizardState.reportType);
    if (wizardState.reportType !== "site-incentives" || hasRefinedInstantReport) {
      return baseSteps;
    }
    return baseSteps.filter(
      (step) => step.id !== "si-project-intake" && step.id !== "si-documents"
    );
  }, [hasRefinedInstantReport, wizardState.reportType]);

  const currentStep = steps[currentStepIndex];
  const totalSteps = steps.length;
  const isLastStep = currentStepIndex === totalSteps - 1;

  // ── Can Proceed Logic ────────────────────────────────────────────

  const canProceed = useMemo(() => {
    if (!currentStep) return false;
    switch (currentStep.inputType) {
      case "report-type":
        return wizardState.reportType !== null;
      case "address":
        return (
          wizardState.address.trim() !== "" &&
          wizardState.lat !== null &&
          wizardState.lon !== null
        );
      case "neighborhood":
        return (
          wizardState.neighborhood.trim() !== "" ||
          (wizardState.address.trim() !== "" && wizardState.lat !== null && wizardState.lon !== null)
        );
      case "project-intake":
        return wizardState.reportType === "site-incentives"
          ? selectedProjectGoals(wizardState).length > 0 &&
              (!selectedProjectGoals(wizardState).includes("other") || Boolean(wizardState.customGoal.trim()))
          : true;
      case "single":
      case "combobox": {
        if (currentStep.id === "si-industry") return true;
        const val = getStepValue(wizardState, currentStep.id);
        return typeof val === "string" && val !== "";
      }
      case "multi": {
        if (currentStep.id === "si-documents" || currentStep.id === "df-documents") {
          return true;
        }
        const val = getStepValue(wizardState, currentStep.id);
        return Array.isArray(val) && val.length > 0;
      }
      case "review":
        return true;
      default:
        return false;
    }
  }, [currentStep, wizardState]);

  // ── Geocode Handler ──────────────────────────────────────────────

  const handleGeocode = useCallback(async (addrOverride?: string) => {
    const addr = addrOverride || addressInput;
    if (!addr.trim()) return;
    setIsGeocoding(true);
    setGeocodeError(null);
    try {
      const data = await cachedFetch<{ lat: number; lon: number; displayName?: string; display_name?: string }>(
        `/api/geocode?address=${encodeURIComponent(addr.trim())}`
      );
      // A 200 with no coordinates IS a genuine not-found (the service
      // answered), so it keeps the address-shaped message rather than
      // falling through to the outage branch below (R1 finding 1).
      if (!data.lat || !data.lon) {
        setGeocodeError(GEOCODE_NOT_FOUND_MESSAGE);
        setGeocodeResult(null);
        return;
      }
      setGeocodeResult({
        lat: data.lat,
        lon: data.lon,
        display_name: data.displayName || data.display_name || addr.trim(),
      });
      setWizardState((prev) => ({
        ...prev,
        address: data.displayName || data.display_name || addr.trim(),
        lat: data.lat,
        lon: data.lon,
      }));
    } catch (err) {
      // R1 finding 1: a 503 from /api/geocode used to render the SAME
      // "try a more specific Chicago address" line as a genuine 404 —
      // blaming the reader's typing for our own outage. `geocodeFailureMessage`
      // reads the upstream status and picks the honest one.
      setGeocodeError(geocodeFailureMessage(err));
      setGeocodeResult(null);
    } finally {
      setIsGeocoding(false);
    }
  }, [addressInput]);

  // ── Navigation ───────────────────────────────────────────────────

  const handleNext = useCallback(() => {
    if (!canProceed) return;

    // If this is the report-type step, reset to the proper step list
    if (currentStep.inputType === "report-type") {
      setDirection(1);
      setCurrentStepIndex(1);
      trackEvent("wizard_step_viewed", {
        reportType: wizardState.reportType,
        source: reportSource,
        metadata: { step: steps[1]?.id ?? "unknown", stepIndex: 1 },
      });
      return;
    }

    if (!isLastStep) {
      setDirection(1);
      setCurrentStepIndex((i) => i + 1);
      const nextStep = steps[currentStepIndex + 1];
      trackEvent("wizard_step_viewed", {
        reportType: wizardState.reportType,
        source: reportSource,
        metadata: { step: nextStep?.id ?? "unknown", stepIndex: currentStepIndex + 1 },
      });
    }
  }, [canProceed, currentStep, isLastStep, currentStepIndex, steps, wizardState.reportType, reportSource]);

  const handleBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setDirection(-1);
      setCurrentStepIndex((i) => i - 1);
    }
  }, [currentStepIndex]);

  const handleStartOver = useCallback(() => {
    setWizardState(INITIAL_WIZARD_STATE);
    setCurrentStepIndex(0);
    setDirection(1);
    setReport(null);
    setRevealedReportKey(null);
    setGeocodeResult(null);
    setAddressInput("");
    setGeocodeError(null);
    setZones(null);
    setZoneNames(null);
    setCensusData(null);
    setCityZoning(null);
    setCityZoningKey(null);
    setParcelData(null);
    setParcelLookupComplete(false);
    setInstantLoading(false);
    setHasRefinedInstantReport(false);
    // Clear instant mode URL params
    router.replace("/report");
  }, [router]);

  const handleRefine = useCallback(() => {
    // refine_clicked is tracked one level down, inside ReportDisplay's
    // handleRefineClick, which knows whether the click came from the banner
    // or the action-row button (RF5) and works the same way whether
    // ReportDisplay is rendered here or reused for a saved Workspace report.
    const refinedState: WizardState = {
      ...wizardState,
      reportType: "site-incentives",
    };
    const industryStepIndex = getStepIndex("site-incentives", "si-industry");

    setWizardState(refinedState);
    setReport(null);
    setCompareReport(null);
    setCompareMode(false);
    setInstantLoading(false);
    setHasRefinedInstantReport(true);
    setCurrentStepIndex(industryStepIndex >= 0 ? industryStepIndex : 1);
    setDirection(1);
    window.history.replaceState(null, "", "/report");
  }, [wizardState]);

  // Refine the second card of a comparison (audit RF4): same jump as
  // handleRefine, but re-pointed at the compared address. Data effects
  // re-fetch from the new lat/lon (already cached from the compare fetch).
  const handleRefineCompareB = useCallback(() => {
    if (!compareGeoResult) return;
    const refinedState: WizardState = {
      ...wizardState,
      reportType: "site-incentives",
      address: compareGeoResult.display_name,
      lat: compareGeoResult.lat,
      lon: compareGeoResult.lon,
      compareAddress: undefined,
      compareLat: undefined,
      compareLon: undefined,
    };
    const industryStepIndex = getStepIndex("site-incentives", "si-industry");

    setWizardState(refinedState);
    setReport(null);
    setCompareReport(null);
    setCompareMode(false);
    setInstantLoading(false);
    setHasRefinedInstantReport(true);
    setCurrentStepIndex(industryStepIndex >= 0 ? industryStepIndex : 1);
    setDirection(1);
    window.history.replaceState(null, "", "/report");
  }, [compareGeoResult, wizardState]);

  const handleCompareGeocode = useCallback(async () => {
    if (!compareAddressInput.trim()) return;
    setCompareGeocoding(true);
    try {
      const data = await cachedFetch<{ lat: number; lon: number; displayName?: string; display_name?: string }>(
        `/api/geocode?address=${encodeURIComponent(compareAddressInput.trim())}`
      );
      if (!data.lat || !data.lon) throw new Error("Address not found");
      setCompareGeoResult({ lat: data.lat, lon: data.lon, display_name: data.displayName || data.display_name || compareAddressInput.trim() });
      setWizardState((prev) => ({
        ...prev,
        compareAddress: data.displayName || data.display_name || compareAddressInput.trim(),
        compareLat: data.lat,
        compareLon: data.lon,
      }));
    } catch {
      setCompareGeoResult(null);
    } finally {
      setCompareGeocoding(false);
    }
  }, [compareAddressInput]);

  // ── Report Generation ────────────────────────────────────────────

  const handleGenerateReport = useCallback(async (overrideState?: WizardState): Promise<GeneratedReport | null> => {
    const stateForReport = overrideState ?? wizardState;
    setIsGenerating(true);
    // A fresh attempt clears the previous failure (R1 finding 1).
    setReportError(null);
    try {
      let economicsForReport = neighborhoodEconomics;
      if (reportZip && neighborhoodEconomicsZip !== reportZip) {
        economicsForReport = await fetchEconomicsWithAnchors(reportZip, stateForReport.lat, stateForReport.lon);
        setNeighborhoodEconomics(economicsForReport);
        setNeighborhoodEconomicsZip(reportZip);
      }
      let supportForReport = localBusinessSupport;
      const supportKey = localSupportRequestKey(stateForReport);
      if (
        stateForReport.lat != null &&
        stateForReport.lon != null &&
        (supportForReport === undefined || localSupportKeyRef.current !== supportKey)
      ) {
        supportForReport = await fetchLocalBusinessSupport(
          stateForReport.lat,
          stateForReport.lon,
          stateForReport,
        );
        setLocalBusinessSupport(supportForReport);
        localSupportKeyRef.current = supportKey;
      }
      let siteSignalsForReport = siteSignals;
      if (stateForReport.lat != null && stateForReport.lon != null && siteSignalsForReport === undefined) {
        siteSignalsForReport = await getSiteSignals(stateForReport.lat, stateForReport.lon).catch(() => null);
        setSiteSignals(siteSignalsForReport);
      }
      let transportForReport = transportAccess;
      if (stateForReport.lat != null && stateForReport.lon != null && transportForReport === undefined) {
        transportForReport = await getTransportAccess(stateForReport.lat, stateForReport.lon).catch(() => null);
        setTransportAccess(transportForReport);
      }
      let mobilityForReport = mobilityAccess;
      if (stateForReport.lat != null && stateForReport.lon != null && mobilityForReport === undefined) {
        mobilityForReport = await cachedFetch<MobilityAccess>(`/api/mobility-access?lat=${stateForReport.lat}&lon=${stateForReport.lon}`).catch(() => null);
        setMobilityAccess(mobilityForReport);
      }
      let zoningForReport = cityZoning;
      if (stateForReport.lat != null && stateForReport.lon != null) {
        const requestKey = zoningLookupKey(stateForReport.lat, stateForReport.lon);
        if (cityZoningKey !== requestKey || !zoningForReport) {
          zoningForReport = await fetchZoningLookup(
            stateForReport.lat,
            stateForReport.lon,
          );
          setCityZoning(zoningForReport);
          setCityZoningKey(requestKey);
        }
      }

      const generated = await generateReportRemote(stateForReport, {
        zones: zones ?? undefined,
        zoneNames: zoneNames ?? undefined,
        unknownZones: zoneUnknowns,
        zoneCheckedAt: zoneCheckedAt ?? undefined,
        census: censusData ?? undefined,
        cityZoning: zoningForReport ?? undefined,
        parcel: parcelData ?? undefined,
        reportZip: reportZip ?? undefined,
        districts: districtsData ?? undefined,
        stackingRules: stackingRules ?? undefined,
        communityAssets: communityAssets ?? undefined,
        localBusinessSupport: supportForReport ?? undefined,
        stats: areaStats ?? undefined,
        corridorMetrics: corridorMetric ?? undefined,
        corridorOwnerClusters,
        neighborhoodEconomics: economicsForReport ?? undefined,
        siteSignals: siteSignalsForReport ?? undefined,
        transport: transportForReport ?? undefined,
        mobilityAccess: mobilityForReport ?? undefined,
      });
      setReport(generated);
      return generated;
    } catch (error) {
      console.error("report generation failed:", error);
      // R1 finding 1: returning null left the reader on the review step with
      // no statement that anything had failed. The wizard surface renders
      // this as an honest retry notice, with every answer still filled in.
      setReportError("wizard");
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [wizardState, zones, zoneNames, censusData, cityZoning, cityZoningKey, parcelData, districtsData, stackingRules, communityAssets, localBusinessSupport, siteSignals, transportAccess, mobilityAccess, areaStats, corridorMetric, corridorOwnerClusters, neighborhoodEconomics, neighborhoodEconomicsZip, reportZip]);

  const handlePrepareGatedReport = useCallback(
    async (projectGoals: string[], customGoal: string): Promise<GeneratedReport | null> => {
      // Gate review round 1, BLOCKER 1 / round 2, ruling #6: the
      // truncation-vs-noop decision lives in `resolveGatePrepareGoals`
      // (lib/gate-goal-groups.ts) — the exact function this line calls,
      // unit-tested directly (including a passthrough-plus-chip-picks
      // probe, which `selectedProjectGoals()`'s MAX_ENGINE_GOALS cap
      // (lib/report-wizard-config.ts — see its own doc comment for the
      // provable-ceiling derivation) would truncate but this must not) so
      // a regression here is caught without mounting the whole report page.
      const existingProjectGoals = report?.metadata?.projectGoals?.length
        ? report.metadata.projectGoals
        : report?.metadata?.projectType
          ? [report.metadata.projectType]
          : [];
      const { isNoop, normalizedGoals } = resolveGatePrepareGoals({
        incomingGoalIds: projectGoals,
        incomingCustomGoal: customGoal,
        existingProjectGoals,
        existingCustomGoal: report?.metadata?.customGoal || "",
      });
      if (isNoop) return report;

      const preparedState: WizardState = {
        ...wizardState,
        reportType: "site-incentives",
        projectGoals: normalizedGoals,
        projectType: normalizedGoals[0] || "",
        customGoal: normalizedGoals.includes("other") ? customGoal.trim() : "",
      };
      setWizardState(preparedState);
      setHasRefinedInstantReport(true);
      setCompareReport(null);
      setCompareMode(false);
      return handleGenerateReport(preparedState);
    },
    [handleGenerateReport, report, wizardState],
  );

  const handleGatedReportReady = useCallback(
    (readyReport: GeneratedReport) => {
      setRevealedReportKey(reportEmailGateKey(readyReport));
      window.scrollTo({ top: 0 });
    },
    [],
  );

  // Inline "quick refine" from the snapshot value panel (audit BM1/RF6):
  // regenerate the report with two answers, without leaving the view.
  const handleQuickRefine = useCallback(
    async (fields: QuickRefineFields) => {
      const projectGoals = selectedProjectGoals({ projectGoals: fields.projectGoals });
      const refinedState: WizardState = {
        ...wizardState,
        reportType: "site-incentives",
        projectGoals,
        projectType: projectGoals[0] || "",
        customGoal: projectGoals.includes("other") ? fields.customGoal.trim() : "",
        budgetRange: fields.budgetRange,
        timeline: fields.timeline || wizardState.timeline,
      };
      setWizardState(refinedState);
      setHasRefinedInstantReport(true);
      setCompareReport(null);
      setCompareMode(false);
      await handleGenerateReport(refinedState);
      // NOTE: the instant URL params are intentionally kept — Next syncs
      // useSearchParams with history.replaceState, and clearing them here
      // would flip reportSource mid-flight and double-fire the generated
      // event with a second source.
      window.scrollTo({ top: 0 });
    },
    [wizardState, handleGenerateReport]
  );

  // ── Value Change Handlers ────────────────────────────────────────

  const handleReportTypeSelect = useCallback((type: ReportType) => {
    setWizardState((prev) => ({ ...prev, reportType: type }));
  }, []);

  const handleSingleSelect = useCallback(
    (stepId: string, value: string) => {
      setWizardState((prev) => setStepValue(prev, stepId, value));
    },
    []
  );

  const handleMultiToggle = useCallback(
    (stepId: string, value: string) => {
      setWizardState((prev) => {
        const current = getStepValue(prev, stepId);
        const arr = Array.isArray(current) ? current : [];
        const next = arr.includes(value)
          ? arr.filter((v) => v !== value)
          : value === "none-yet"
            ? ["none-yet"]
            : [...arr.filter((v) => v !== "none-yet"), value];
        return setStepValue(prev, stepId, next);
      });
    },
    []
  );

  const handleMultiSetAll = useCallback(
    (stepId: string, values: string[]) => {
      setWizardState((prev) => setStepValue(prev, stepId, values));
    },
    []
  );

  const handleProjectIntakeChange = useCallback(
    (key: keyof WizardState, value: string | string[]) => {
      setWizardState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // ── Report generation failure (R1 finding 1) ───────────────────
  //
  // Rendered BEFORE the loading block below, because the two used to be the
  // same screen: a failed generation left `instantLoading` true and the reader
  // watched the spinner forever. The retry re-runs the SAME generation path
  // that failed — instant by re-arming its own `instantLoading` gate, corridor
  // and shared-report by bumping `retryNonce` (see its declaration: their
  // gates cannot be re-armed, because a failure never sets them) — so the
  // identical effect fires again with the identical inputs, rather than
  // reloading the page and throwing away everything already fetched.
  if (
    reportError === "instant" ||
    reportError === "corridor" ||
    reportError === "shared_report"
  ) {
    const copy = REPORT_GENERATION_FAILURE_COPY[reportError];
    const retry = () => {
      const source = reportError;
      setReportError(null);
      if (source === "instant") {
        // Instant's gate IS `instantLoading`, and a failure leaves it false —
        // so flipping it true is both the re-arm and the loading state.
        setInstantLoading(true);
        return;
      }
      // Corridor and shared-report gates (`corridorAutoGenerated` /
      // `shareAutoGenerated`) are already false after a failure — see the
      // `retryNonce` comment at its declaration for why re-setting them was a
      // no-op that issued no second request. Bumping the nonce is the real
      // re-trigger; `setIsGenerating(true)` covers the ~300ms before the
      // effect's own timer fires, so the reader goes back to the spinner
      // instead of flashing an empty wizard.
      setIsGenerating(true);
      setRetryNonce((n) => n + 1);
    };
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center px-4">
        <div className="w-full max-w-lg" data-testid="report-generation-error">
          <p className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/45">
            {copy.eyebrow}
          </p>
          <h1 className="mt-3 font-editorial text-[34px] leading-[0.98] text-[#0C1B33] sm:text-[40px]">
            {copy.heading}
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[#0C1B33]/60">{copy.body}</p>
          {(isCorridorMode ? corridorParam : instantAddr) && (
            <p className="mt-3 font-mono-bureau text-[12px] text-[#0C1B33]/40">
              {isCorridorMode ? `ZIP ${corridorParam}` : instantAddr}
            </p>
          )}
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={retry}
              data-testid="report-generation-retry"
              className="inline-flex min-h-11 items-center bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
            >
              {copy.retryLabel}
            </button>
            <button
              type="button"
              onClick={handleStartOver}
              className="inline-flex min-h-11 items-center border border-[#0C1B33]/20 bg-white px-4 py-3 text-[12px] font-semibold text-[#0C1B33]/70 transition-colors hover:border-[#2563EB] hover:text-[#2563EB]"
            >
              Start a new search
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Instant mode loading state ─────────────────────────────────

  if (
    instantLoading ||
    (isInstantMode && !report && isGenerating) ||
    (isCorridorMode && !report && (corridorLoading || isGenerating))
  ) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <div className="text-center">
          <div className="flex gap-1.5 justify-center mb-4">
            <div className="w-2 h-2 bg-[#2563EB]/40 rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-[#2563EB]/40 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
            <div className="w-2 h-2 bg-[#2563EB]/40 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
          </div>
          <p className="font-mono-bureau text-[11px] tracking-[0.15em] uppercase text-[#0C1B33]/30 mb-2">
            {isCorridorMode
              ? "Generating Corridor Intelligence"
              : hasRefinedInstantReport
                ? "Generating Refined Report"
                : "Generating Location Snapshot"}
          </p>
          {(isCorridorMode ? corridorParam : instantAddr) && (
            <p className="text-[13px] text-[#0C1B33]/40">
              {isCorridorMode ? `ZIP ${corridorParam}` : instantAddr}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── If report is generated, show report display ──────────────────

  const conciergeLocalSupport = report?.communityAssets?.organizations
    ?.slice(0, 6)
    .map((organization) => ({
      id: organization.id || "",
      name: organization.name,
      role: organization.role,
      supportTypes: organization.supportTypes,
      serviceGeography: organization.serviceGeography,
      website: organization.website,
      supportLanes: organization.supportLanes,
    }));

  if (report && compareReport) {
    return (
      <div className="min-h-screen">
        <ComparisonDisplay
          reportA={report}
          reportB={compareReport}
          onStartOver={handleStartOver}
          wizardState={wizardState}
          isInstantMode={isInstantMode && !hasRefinedInstantReport}
          onRefineA={handleRefine}
          onRefineB={handleRefineCompareB}
        />
        <ConciergePageContextBridge
          route="/report"
          pageLabel="Report comparison"
          reportSummary={report.summary}
          address={report.metadata?.address}
          lat={report.metadata?.lat}
          lon={report.metadata?.lon}
          localSupportOrganizations={conciergeLocalSupport}
          capitalSupportId={report.capitalPartnerHandoff?.primary?.partnerId}
          capitalSupportName={report.capitalPartnerHandoff?.primary?.name}
          capitalSupportReason={report.capitalPartnerHandoff?.primary?.reason}
          capitalSupportFitNote={report.capitalPartnerHandoff?.primary?.fitNote}
          capitalSupportIntakeUrl={
            report.capitalPartnerHandoff?.primary?.intakeUrl
              || report.capitalPartnerHandoff?.primary?.website
          }
        />
      </div>
    );
  }

  if (report) {
    // The first-visit tour promises "does not ask for an email", so its
    // sample report renders ungated; organic reports keep the gate.
    // Shared-link recipient fix (spec v2 deliverable 7): a framed link's
    // decoded wizard state (`pg=`) can already carry a complete goal
    // selection — the sender already answered the gate's own question. Every
    // real recipient of a shared site-incentives link was previously
    // re-blocked by the same gate the sender had already cleared.
    const shareLinkGoalsComplete = isShareMode && projectGoalsAreComplete(wizardState);
    const showEmailGate = reportRequiresEmailGate(report)
      && revealedReportKey !== reportEmailGateKey(report)
      && reportSource !== "welcome_tour"
      && !shareLinkGoalsComplete;
    // Cross-links only make sense once results for a resolved address are
    // actually on screen: not behind the email gate, and not on a corridor
    // report that has no address to be "near".
    const hasResolvedAddress =
      (report.metadata?.lat ?? wizardState.lat) != null &&
      (report.metadata?.lon ?? wizardState.lon) != null;
    const showCrossLinks = hasResolvedAddress && !showEmailGate;
    return (
      <div className="min-h-screen">
        <ReportDisplay
          surface="live"
          report={report}
          onStartOver={handleStartOver}
          onRefine={handleRefine}
          onQuickRefine={handleQuickRefine}
          refineContext="instant"
          quickRefineBusy={isGenerating}
          isInstantMode={isInstantMode && !hasRefinedInstantReport}
          // BLOCKER fix (adversarial design review #2): the persona lens
          // must be visible whenever the wizard state is a site-incentives
          // report — not just on a fresh instant snapshot. `isInstantMode`
          // gated the chips off on every shared link and every goal-refined
          // report, so a forwarded `?persona=` was inert on arrival. This
          // mirrors the (already-correct) workspace fork
          // (app/workspace/reports/[id]/page.tsx).
          showPersonaLens={derivePersonaLensVisible(wizardState)}
          persona={persona}
          onPersonaSelect={handlePersonaSelect}
          wizardState={wizardState}
          onCompare={() => setCompareMode(true)}
          compareMode={compareMode}
          compareAddressInput={compareAddressInput}
          setCompareAddressInput={setCompareAddressInput}
          compareGeocoding={compareGeocoding}
          onCompareGeocode={handleCompareGeocode}
          comparisonFailed={reportError === "comparison"}
          compareGeoResult={compareGeoResult}
          analyticsSource={reportSource}
        />
        {showCrossLinks && (
          <InlineCrossLinkBanner
            pin={
              parcelData?.addressMatch === "mismatch" ? null : parcelData?.pin
            }
          />
        )}
        {showEmailGate && (
          <ReportEmailGate
            report={report}
            source={reportSource}
            wizardState={wizardState}
            onPrepareReport={handlePrepareGatedReport}
            onReportReady={handleGatedReportReady}
            onPersonaCommitted={setPersona}
          />
        )}
        {/* The guide yields to the optional email dialog and returns once the
            report is visible again. */}
        <ConciergePageContextBridge
          suppressed={showEmailGate}
          route="/report"
          pageLabel="Incentive report"
          reportSummary={report.summary}
          address={report.metadata?.address}
          lat={report.metadata?.lat}
          lon={report.metadata?.lon}
          localSupportOrganizations={conciergeLocalSupport}
          capitalSupportId={report.capitalPartnerHandoff?.primary?.partnerId}
          capitalSupportName={report.capitalPartnerHandoff?.primary?.name}
          capitalSupportReason={report.capitalPartnerHandoff?.primary?.reason}
          capitalSupportFitNote={report.capitalPartnerHandoff?.primary?.fitNote}
          capitalSupportIntakeUrl={
            report.capitalPartnerHandoff?.primary?.intakeUrl
              || report.capitalPartnerHandoff?.primary?.website
          }
        />
      </div>
    );
  }

  // ── Wizard UI ────────────────────────────────────────────────────

  return (
    <div className="bg-[#FAF9F6] min-h-screen">
      <section className="py-20 px-6">
        <div className="container mx-auto max-w-2xl">
          {/* Page header */}
          <div className="text-center mb-14">
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="accent-bar" />
              <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/30">
                Report Builder
              </span>
              <div className="accent-bar" />
            </div>
            <h1 className="font-editorial text-3xl sm:text-4xl md:text-5xl text-[#0C1B33] mb-4">
              Build Your Report
            </h1>
            <p className="font-mono-bureau text-[11px] text-[#0C1B33]/40 uppercase tracking-[0.1em] max-w-md mx-auto">
              Customize a comprehensive incentive report for your business
            </p>
          </div>

          {/* Wizard content */}
          <div className="flex flex-col min-h-[60vh]">
            {/* Progress bar */}
            <div className="mb-10">
              <WizardProgressBar
                steps={steps}
                currentStepIndex={currentStepIndex}
              />
            </div>

            {/* Step content */}
            <div className="flex-1">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={currentStep.id}
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={stepTransition}
                >
                  {/* Step label + title */}
                  <div className="mb-8">
                    <span className="font-mono-bureau text-[10px] text-[#0C1B33]/25 uppercase tracking-[0.2em] block mb-3">
                      Step {currentStepIndex + 1} of {totalSteps}
                    </span>
                    <h2 className="font-editorial text-2xl sm:text-3xl text-[#0C1B33] mb-2">
                      {currentStep.title}
                    </h2>
                    {currentStep.subtitle && (
                      <p className="font-mono-bureau text-[11px] text-[#0C1B33]/40 uppercase tracking-[0.1em]">
                        {currentStep.subtitle}
                      </p>
                    )}
                  </div>

                  {/* Step body by type */}
                  {currentStep.inputType === "report-type" && (
                    <ReportTypeStep
                      selected={wizardState.reportType}
                      onSelect={handleReportTypeSelect}
                    />
                  )}

                  {currentStep.inputType === "address" && (
                    <AddressStep
                      addressInput={addressInput}
                      setAddressInput={setAddressInput}
                      geocodeResult={geocodeResult}
                      isGeocoding={isGeocoding}
                      geocodeError={geocodeError}
                      onGeocode={handleGeocode}
                    />
                  )}

                  {currentStep.inputType === "neighborhood" && (
                    <NeighborhoodStep
                      neighborhood={wizardState.neighborhood}
                      onSelectNeighborhood={(name, lat, lon) => {
                        setWizardState((prev) => ({
                          ...prev,
                          neighborhood: name,
                          lat,
                          lon,
                          address: "",
                        }));
                        // Clear any previous address-based data
                        setGeocodeResult(null);
                      }}
                      addressInput={addressInput}
                      setAddressInput={setAddressInput}
                      geocodeResult={geocodeResult}
                      isGeocoding={isGeocoding}
                      geocodeError={geocodeError}
                      onGeocode={(addr) => {
                        // When using specific address, clear neighborhood
                        handleGeocode(addr);
                        setWizardState((prev) => ({
                          ...prev,
                          neighborhood: "",
                        }));
                      }}
                    />
                  )}

                  {currentStep.inputType === "project-intake" && (
                    <ProjectIntakeStep
                      wizardState={wizardState}
                      onChange={handleProjectIntakeChange}
                      isOptional
                    />
                  )}

                  {currentStep.inputType === "combobox" && currentStep.options && (
                    <ComboboxStep
                      stepId={currentStep.id}
                      options={currentStep.options}
                      value={
                        (getStepValue(wizardState, currentStep.id) as string) ||
                        ""
                      }
                      onSelect={handleSingleSelect}
                    />
                  )}

                  {currentStep.inputType === "single" && currentStep.options && (
                    <SingleSelectStep
                      stepId={currentStep.id}
                      options={currentStep.options}
                      value={
                        (getStepValue(wizardState, currentStep.id) as string) ||
                        ""
                      }
                      onSelect={handleSingleSelect}
                    />
                  )}

                  {currentStep.inputType === "multi" && currentStep.options && (
                    <MultiSelectStep
                      stepId={currentStep.id}
                      options={currentStep.options}
                      value={
                        (getStepValue(wizardState, currentStep.id) as string[]) ||
                        []
                      }
                      onToggle={handleMultiToggle}
                      onSetAll={handleMultiSetAll}
                    />
                  )}

                  {currentStep.inputType === "review" && (
                    <>
                      {/* R1 finding 1: a failed wizard generation returned null
                          and said nothing — the reader was left staring at an
                          unchanged review step. The retry re-runs the SAME
                          handleGenerateReport call with the same answers. */}
                      {reportError === "wizard" && (
                        <div
                          data-testid="wizard-generation-error"
                          className="mb-5 border border-[#0C1B33]/15 bg-white px-4 py-3"
                        >
                          <p className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/45">
                            {REPORT_GENERATION_FAILURE_COPY.wizard.eyebrow}
                          </p>
                          <p className="mt-2 text-[14px] font-medium text-[#0C1B33]">
                            {REPORT_GENERATION_FAILURE_COPY.wizard.heading}
                          </p>
                          <p className="mt-1.5 text-[13px] leading-relaxed text-[#0C1B33]/65">
                            {REPORT_GENERATION_FAILURE_COPY.wizard.body}
                          </p>
                          <button
                            type="button"
                            data-testid="wizard-generation-retry"
                            onClick={() => handleGenerateReport()}
                            disabled={isGenerating}
                            className="mt-3 inline-flex min-h-9 items-center bg-[#2563EB] px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-40"
                          >
                            {REPORT_GENERATION_FAILURE_COPY.wizard.retryLabel}
                          </button>
                        </div>
                      )}
                      <ReviewStep
                        wizardState={wizardState}
                        steps={steps}
                        isGenerating={isGenerating}
                        onGenerate={() => handleGenerateReport()}
                      />
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <WizardSelectionSummary
              wizardState={wizardState}
              steps={steps}
            />

            {/* Navigation */}
            {currentStep.inputType !== "review" && (
              <div className="flex items-center justify-between mt-10 pt-6 border-t border-[#0C1B33]/6">
                <button
                  onClick={handleBack}
                  disabled={currentStepIndex === 0}
                  className={`inline-flex items-center gap-2 font-mono-bureau text-[11px] uppercase tracking-[0.1em] cursor-pointer ${
                    currentStepIndex === 0
                      ? "text-[#0C1B33]/10 cursor-default"
                      : "text-[#0C1B33]/35 hover:text-[#0C1B33]"
                  }`}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>

                <button
                  onClick={handleNext}
                  disabled={!canProceed}
                  className={`inline-flex items-center gap-2 font-mono-bureau text-[11px] uppercase tracking-[0.1em] px-6 py-3 border cursor-pointer transition-colors ${
                    canProceed
                      ? "bg-[#0C1B33] text-white border-[#0C1B33] hover:bg-[#2563EB] hover:border-[#2563EB]"
                      : "bg-transparent text-[#0C1B33]/15 border-[#0C1B33]/8 cursor-default"
                  }`}
                >
                  Next
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
      {/* review8 S23 (MEDIUM): was `wizardState.lat || undefined` /
          `wizardState.lon || undefined` — a truthy fallback that turns a
          validated (0, 0) pair into `undefined`, silently disabling
          location-aware concierge checks for exactly the coordinate S13
          fixed everywhere else in this file. `?? undefined` is a no-op
          here (both fields are already `number | null`, and the prop
          type presumably accepts `null` too) but documents the intent
          and matches this file's own `hasWizardCoords`/`!= null`
          discipline — `address` stays `||` since an empty string IS
          the correct "no address" fallback there, not a false-negative
          risk the way `0` is for coordinates. */}
      <ConciergePageContextBridge
        route="/report"
        pageLabel="Report builder"
        address={wizardState.address || undefined}
        lat={wizardState.lat ?? undefined}
        lon={wizardState.lon ?? undefined}
      />
    </div>
  );
}

// ─── Live Selection Summary ──────────────────────────────────────────

function WizardSelectionSummary({
  wizardState,
  steps,
}: {
  wizardState: WizardState;
  steps: WizardStepConfig[];
}) {
  const items = getWizardSelectionItems(wizardState, steps);
  if (items.length === 0) return null;

  return (
    <div className="sticky bottom-4 z-20 mt-10">
      <div className="bg-white/95 backdrop-blur border border-[#0C1B33]/10 shadow-sm px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {items.slice(0, 4).map((item) => (
            <div
              key={`${item.label}-${item.value}`}
              className="min-w-0 max-w-full border border-[#0C1B33]/8 bg-[#FAF9F6] px-3 py-2"
            >
              <span className="block font-mono-bureau text-[7px] tracking-[0.22em] uppercase text-[#0C1B33]/25">
                {item.label}
              </span>
              <span className="block text-[12px] text-[#0C1B33]/70 truncate max-w-[220px]">
                {item.value}
              </span>
            </div>
          ))}
          {items.length > 4 && (
            <span className="font-mono-bureau text-[9px] tracking-[0.14em] uppercase text-[#0C1B33]/30 px-2">
              +{items.length - 4} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Progress Bar ────────────────────────────────────────────────────

function WizardProgressBar({
  steps,
  currentStepIndex,
}: {
  steps: WizardStepConfig[];
  currentStepIndex: number;
}) {
  return (
    <div>
      {/* Dots row */}
      <div className="flex items-center gap-0 w-full max-w-lg mx-auto">
        {steps.map((step, i) => {
          const isCompleted = i < currentStepIndex;
          const isActive = i === currentStepIndex;

          return (
            <div
              key={step.id}
              className="flex items-center flex-1 last:flex-none"
            >
              <div
                className={`w-8 h-8 flex items-center justify-center border flex-shrink-0 transition-colors ${
                  isCompleted
                    ? "bg-[#2563EB] border-[#2563EB]"
                    : isActive
                      ? "bg-transparent border-[#2563EB]"
                      : "bg-transparent border-[#0C1B33]/10"
                }`}
              >
                {isCompleted ? (
                  <Check
                    className="w-3.5 h-3.5 text-white"
                    strokeWidth={2.5}
                  />
                ) : (
                  <span
                    className={`font-mono-bureau text-[11px] font-medium ${
                      isActive ? "text-[#2563EB]" : "text-[#0C1B33]/20"
                    }`}
                  >
                    {i + 1}
                  </span>
                )}
              </div>

              {i < steps.length - 1 && (
                <div className="flex-1 h-[1px] mx-2">
                  <div
                    className={`h-full ${
                      isCompleted ? "bg-[#2563EB]" : "bg-[#0C1B33]/8"
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Step title below */}
      <div className="text-center mt-4">
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30">
          {steps[currentStepIndex]?.title || ""}
        </span>
      </div>
    </div>
  );
}

// ─── Report Type Step ────────────────────────────────────────────────

function ReportTypeStep({
  selected,
  onSelect,
}: {
  selected: ReportType | null;
  onSelect: (type: ReportType) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {REPORT_TYPE_OPTIONS.filter((option) => !option.hidden).map((option, i) => {
        const isSelected = selected === option.id;
        const isBeta = option.availability === "beta";
        const cardClassName = `group relative block h-full text-left p-5 transition-all duration-150 ${
          isSelected
            ? "bg-white border-2 border-[#2563EB] shadow-sm"
            : isBeta
              ? "bg-[#F3F4F6] border border-[#0C1B33]/8 text-[#0C1B33]/45 hover:border-[#0C1B33]/16"
              : "bg-white border border-[#0C1B33]/10 hover:border-[#0C1B33]/20"
        }`;
        const contents = (
          <>
            {isBeta ? (
              <span className="absolute right-3 top-3 border border-[#0C1B33]/12 bg-white/60 px-2 py-1 font-mono-bureau text-[8px] uppercase tracking-[0.16em] text-[#0C1B33]/38">
                Beta · Early access
              </span>
            ) : null}
            <div className={`text-3xl mb-3 ${isBeta ? "grayscale opacity-45" : ""}`}>
              {option.icon}
            </div>
            <h3
              className={`font-mono-bureau text-[12px] tracking-[0.08em] uppercase mb-1 ${
                isSelected
                  ? "text-[#0C1B33]"
                  : isBeta
                    ? "text-[#0C1B33]/45"
                    : "text-[#0C1B33]/70"
              }`}
            >
              {option.title}
            </h3>
            <p className={`text-[13px] leading-relaxed ${isBeta ? "text-[#0C1B33]/35" : "text-[#0C1B33]/40"}`}>
              {option.subtitle}
            </p>
            <p className="mt-3 border-t border-[#0C1B33]/6 pt-3 font-mono-bureau text-[9px] tracking-[0.08em] uppercase leading-relaxed text-[#0C1B33]/35">
              {option.bestFor}
            </p>
            {option.href ? (
              <span className={`mt-4 inline-block font-mono-bureau text-[9px] uppercase tracking-[0.14em] ${isBeta ? "text-[#0C1B33]/45" : "text-[#2563EB]"}`}>
                {isBeta ? "Request early access" : "Open analysis"} &rarr;
              </span>
            ) : null}

            {isSelected ? (
              <div className="absolute top-3 right-3 w-5 h-5 bg-[#2563EB] flex items-center justify-center">
                <Check className="w-3 h-3 text-white" strokeWidth={2.5} />
              </div>
            ) : null}
          </>
        );

        if (option.href) {
          return (
            <motion.div
              key={option.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.06, ease: "easeOut" }}
            >
              <Link href={option.href} className={cardClassName}>
                {contents}
              </Link>
            </motion.div>
          );
        }

        return (
          <motion.button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id as ReportType)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.3,
              delay: i * 0.06,
              ease: "easeOut",
            }}
            className={`${cardClassName} cursor-pointer`}
          >
            {contents}
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Address Step ────────────────────────────────────────────────────

// ─── Neighborhood Step (dropdown + optional address) ─────────────────

function NeighborhoodStep({
  neighborhood,
  onSelectNeighborhood,
  addressInput,
  setAddressInput,
  geocodeResult,
  isGeocoding,
  geocodeError,
  onGeocode,
}: {
  neighborhood: string;
  onSelectNeighborhood: (name: string, lat: number, lon: number) => void;
  addressInput: string;
  setAddressInput: (v: string) => void;
  geocodeResult: { lat: number; lon: number; display_name: string } | null;
  isGeocoding: boolean;
  geocodeError: string | null;
  onGeocode: (addr: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [useAddress, setUseAddress] = useState(false);

  // Import community areas
  const [areas, setAreas] = useState<{ id: number; name: string; lat: number; lon: number }[]>([]);
  useEffect(() => {
    import("@/lib/community-areas").then((mod) => {
      setAreas(mod.CHICAGO_COMMUNITY_AREAS);
    });
  }, []);

  const filtered = query
    ? areas.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
    : areas;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && useAddress) {
      e.preventDefault();
      onGeocode(addressInput);
    }
  };

  return (
    <div className="space-y-6">
      {/* Neighborhood picker */}
      {!useAddress && (
        <div className="relative">
          <div className="relative">
            <input
              type="text"
              value={open ? query : neighborhood}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!open) setOpen(true);
              }}
              onFocus={() => {
                setOpen(true);
                setQuery("");
              }}
              placeholder="Search neighborhoods..."
              className="w-full h-14 bg-white border border-[#0C1B33]/12 px-5 pr-12 text-[#0C1B33] text-sm placeholder:text-[#0C1B33]/30 focus:outline-none focus:border-[#2563EB]/50 focus:ring-2 focus:ring-[#2563EB]/10 font-mono-bureau tracking-wide transition-all"
            />
            <button
              onClick={() => setOpen(!open)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0C1B33]/30"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={open ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
              </svg>
            </button>
          </div>

          {open && (
            <>
              <div className="absolute z-30 w-full mt-1 bg-white border border-[#0C1B33]/10 shadow-xl max-h-64 overflow-y-auto">
                {filtered.map((area) => {
                  const isSelected = neighborhood === area.name;
                  return (
                    <button
                      key={area.id}
                      onClick={() => {
                        onSelectNeighborhood(area.name, area.lat, area.lon);
                        setQuery("");
                        setOpen(false);
                      }}
                      className={`w-full text-left px-5 py-3 border-b border-[#0C1B33]/5 last:border-b-0 transition-colors ${
                        isSelected ? "bg-[#EFF3FB]" : "hover:bg-[#0C1B33]/[0.02]"
                      }`}
                    >
                      <span className={`font-mono-bureau text-[11px] tracking-[0.08em] uppercase ${
                        isSelected ? "text-[#2563EB]" : "text-[#0C1B33]/60"
                      }`}>
                        {area.name}
                      </span>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="px-5 py-3 text-[#0C1B33]/30 text-[12px]">
                    No matching neighborhood
                  </div>
                )}
              </div>
              <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); setQuery(""); }} />
            </>
          )}

          {neighborhood && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 bg-white border border-[#2563EB]/20 p-4 flex items-start gap-3"
            >
              <MapPin className="w-4 h-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] text-[#0C1B33]/70 font-medium">{neighborhood}</p>
                <p className="font-mono-bureau text-[10px] text-[#0C1B33]/30 mt-0.5">
                  Community Area &middot; Neighborhood-level analysis
                </p>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Toggle */}
      <button
        onClick={() => setUseAddress(!useAddress)}
        className="font-mono-bureau text-[11px] tracking-[0.1em] text-[#2563EB]/60 hover:text-[#2563EB] transition-colors"
      >
        {useAddress ? "\u2190 Pick a neighborhood instead" : "Or enter a specific address for parcel-level detail \u2192"}
      </button>

      {/* Address input (when toggled) */}
      {useAddress && (
        <div>
          <div className="relative">
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter a Chicago address..."
              className="w-full bg-white border border-[#0C1B33]/10 px-5 py-4 pr-14 text-[#0C1B33] text-[15px] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB] transition-colors"
            />
            <button
              onClick={() => onGeocode(addressInput)}
              aria-label="Verify address"
              title="Verify address"
              disabled={isGeocoding || !addressInput.trim()}
              className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${
                isGeocoding || !addressInput.trim() ? "text-[#0C1B33]/15" : "text-[#2563EB] hover:text-[#1d4ed8]"
              }`}
            >
              {isGeocoding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={() => onGeocode(addressInput)}
              disabled={isGeocoding || !addressInput.trim()}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 border font-mono-bureau text-[10px] tracking-[0.14em] uppercase transition-colors ${
                isGeocoding || !addressInput.trim()
                  ? "border-[#0C1B33]/8 text-[#0C1B33]/20 cursor-default"
                  : "border-[#2563EB] bg-[#2563EB] text-white hover:bg-[#1d4ed8] hover:border-[#1d4ed8] cursor-pointer"
              }`}
            >
              {isGeocoding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              Verify Address
            </button>
            <p className="font-mono-bureau text-[9px] text-[#0C1B33]/25 uppercase tracking-[0.15em] leading-relaxed">
              Verify a specific address to load parcel-level detail.
            </p>
          </div>

          {geocodeResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 bg-white border border-[#2563EB]/20 p-4 flex items-start gap-3"
            >
              <MapPin className="w-4 h-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] text-[#0C1B33]/70 font-medium">{geocodeResult.display_name}</p>
                <p className="font-mono-bureau text-[10px] text-[#0C1B33]/30 mt-0.5">
                  Specific address &middot; Parcel-level detail
                </p>
              </div>
            </motion.div>
          )}

          {geocodeError && (
            <div className="mt-3 flex items-start gap-2 text-red-600 bg-red-50 border border-red-200 px-4 py-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-[13px]">{geocodeError}</span>
            </div>
          )}

          <p className="font-mono-bureau text-[10px] text-[#0C1B33]/25 mt-2">
            Tip: A specific address loads property PIN, assessed value, and zoning data.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Address Step ───────────────────────────────────────────────────

function AddressStep({
  addressInput,
  setAddressInput,
  geocodeResult,
  isGeocoding,
  geocodeError,
  onGeocode,
}: {
  addressInput: string;
  setAddressInput: (v: string) => void;
  geocodeResult: { lat: number; lon: number; display_name: string } | null;
  isGeocoding: boolean;
  geocodeError: string | null;
  onGeocode: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onGeocode();
    }
  };

  return (
    <div>
      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a Chicago address..."
          className="w-full bg-white border border-[#0C1B33]/10 px-5 py-4 pr-14 text-[#0C1B33] text-[15px] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#2563EB] transition-colors"
        />
        <button
          onClick={() => onGeocode()}
          aria-label="Verify address"
          title="Verify address"
          disabled={isGeocoding || !addressInput.trim()}
          className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center transition-colors cursor-pointer ${
            isGeocoding || !addressInput.trim()
              ? "text-[#0C1B33]/15"
              : "text-[#2563EB] hover:text-[#1d4ed8]"
          }`}
        >
          {isGeocoding ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          onClick={() => onGeocode()}
          disabled={isGeocoding || !addressInput.trim()}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 border font-mono-bureau text-[10px] tracking-[0.14em] uppercase transition-colors ${
            isGeocoding || !addressInput.trim()
              ? "border-[#0C1B33]/8 text-[#0C1B33]/20 cursor-default"
              : "border-[#2563EB] bg-[#2563EB] text-white hover:bg-[#1d4ed8] hover:border-[#1d4ed8] cursor-pointer"
          }`}
        >
          {isGeocoding ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5" />
          )}
          Verify Address
        </button>
        <p className="font-mono-bureau text-[9px] text-[#0C1B33]/25 uppercase tracking-[0.15em] leading-relaxed">
          Verify the address to enable Next.
        </p>
      </div>

      {/* Geocode result */}
      {geocodeResult && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-4 bg-white border border-[#2563EB]/20 p-4 flex items-start gap-3"
        >
          <MapPin className="w-4 h-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-mono-bureau text-[10px] text-[#2563EB] uppercase tracking-[0.15em] block mb-1">
              Resolved Address
            </span>
            <p className="text-[#0C1B33] text-sm leading-relaxed">
              {geocodeResult.display_name}
            </p>
            <p className="font-mono-bureau text-[9px] text-[#0C1B33]/25 mt-1 tracking-wider">
              {geocodeResult.lat.toFixed(6)}, {geocodeResult.lon.toFixed(6)}
            </p>
          </div>
        </motion.div>
      )}

      {/* Geocode error */}
      {geocodeError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-4 bg-red-50 border border-red-200 p-4 flex items-start gap-3"
        >
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{geocodeError}</p>
        </motion.div>
      )}

      {/* Helper text */}
      <p className="mt-4 font-mono-bureau text-[9px] text-[#0C1B33]/25 uppercase tracking-[0.15em] leading-relaxed">
        Tip: Include street number for best results. Press Enter or verify address to continue.
      </p>
    </div>
  );
}

// ─── Project Intake Step ─────────────────────────────────────────────

function ProjectIntakeStep({
  wizardState,
  onChange,
  isOptional = false,
}: {
  wizardState: WizardState;
  onChange: (key: keyof WizardState, value: string | string[]) => void;
  isOptional?: boolean;
}) {
  const toggleNeed = (id: string) => {
    const current = wizardState.supportNeeded || [];
    const next = current.includes(id)
      ? current.filter((value) => value !== id)
      : id === "not-sure"
        ? ["not-sure"]
        : [...current.filter((value) => value !== "not-sure"), id];
    onChange("supportNeeded", next);
  };

  if (wizardState.reportType === "dev-feasibility") {
    return (
      <div className="space-y-8">
        <div className="border border-[#0C1B33]/8 bg-white px-4 py-3">
          <p className="text-[12px] text-[#0C1B33]/45 leading-relaxed">
            These questions are optional. Answer what you know, or skip ahead if you are still comparing sites.
          </p>
        </div>

        <IntakeField
          label="Project focus"
          helper="Choose the closest pathway for the vacant property or site."
          options={VACANCY_PROJECT_TYPE_OPTIONS}
          value={wizardState.projectType}
          onSelect={(value) => onChange("projectType", value)}
        />

        <IntakeField
          label="What would you like to create?"
          helper="This helps separate the site activity from the intended end use."
          options={PROPOSED_USE_OPTIONS}
          value={wizardState.proposedUse}
          onSelect={(value) => onChange("proposedUse", value)}
        />

        <div>
          <div className="flex items-center justify-between gap-4 mb-3">
            <label className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/45">
              What support would be most helpful?
            </label>
            <span className="font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/25">
              Optional
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUPPORT_NEEDED_OPTIONS.map((option) => {
              const selected = wizardState.supportNeeded.includes(option.id);
              return (
                <button
                  key={option.id}
                  onClick={() => toggleNeed(option.id)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2.5 border font-mono-bureau text-[10px] tracking-[0.1em] uppercase transition-colors ${
                    selected
                      ? "bg-[#0C1B33] border-[#0C1B33] text-white"
                      : "bg-white border-[#0C1B33]/10 text-[#0C1B33]/45 hover:border-[#0C1B33]/20"
                  }`}
                >
                  {selected && <Check className="w-3 h-3" />}
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ProjectGoalSelector
        goals={selectedProjectGoals(wizardState)}
        customGoal={wizardState.customGoal}
        onChange={(goals, customGoal) => {
          onChange("projectGoals", goals);
          onChange("projectType", goals[0] || "");
          onChange("customGoal", customGoal);
        }}
        required
      />

      <IntakeField
        label="Total project budget"
        helper="Use a range if the budget is still being scoped."
        options={[...BUDGET_RANGE_OPTIONS, { id: "skip", label: "Still estimating" }]}
        value={wizardState.budgetRange}
        onSelect={(value) => onChange("budgetRange", value)}
        required={!isOptional}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <IntakeField
          label="Funding already committed"
          options={FUNDING_COMMITTED_OPTIONS}
          value={wizardState.fundingCommitted}
          onSelect={(value) => onChange("fundingCommitted", value)}
        />
        <IntakeField
          label="Remaining funding gap"
          options={REMAINING_GAP_OPTIONS}
          value={wizardState.remainingGap}
          onSelect={(value) => onChange("remainingGap", value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <IntakeField
          label="Timeline"
          options={TIMELINE_OPTIONS}
          value={wizardState.timeline}
          onSelect={(value) => onChange("timeline", value)}
          required={!isOptional}
        />
        <IntakeField
          label="Own vs. lease"
          options={SITE_CONTROL_OPTIONS}
          value={wizardState.siteControl}
          onSelect={(value) => onChange("siteControl", value)}
          required={!isOptional}
        />
      </div>

      <IntakeField
        label="Jobs created or retained"
        options={JOBS_IMPACT_OPTIONS}
        value={wizardState.jobsImpact}
        onSelect={(value) => onChange("jobsImpact", value)}
      />

      <div>
        <div className="flex items-center justify-between gap-4 mb-3">
          <label className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/45">
            What support would be most helpful?
          </label>
          <span className="font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/25">
            Select all that apply
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUPPORT_NEEDED_OPTIONS.map((option) => {
            const selected = wizardState.supportNeeded.includes(option.id);
            return (
              <button
                key={option.id}
                onClick={() => toggleNeed(option.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2.5 border font-mono-bureau text-[10px] tracking-[0.1em] uppercase transition-colors ${
                  selected
                    ? "bg-[#0C1B33] border-[#0C1B33] text-white"
                    : "bg-white border-[#0C1B33]/10 text-[#0C1B33]/45 hover:border-[#0C1B33]/20"
                }`}
              >
                {selected && <Check className="w-3 h-3" />}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border border-[#0C1B33]/8 bg-white px-4 py-3">
        <p className="text-[12px] text-[#0C1B33]/45 leading-relaxed">
          These answers help tailor the readiness checklist and next-step language.
          The report will not estimate award amounts or guarantee funding.
        </p>
      </div>
    </div>
  );
}

function IntakeField({
  label,
  helper,
  options,
  value,
  onSelect,
  required,
}: {
  label: string;
  helper?: string;
  options: { id: string; label: string }[];
  value: string;
  onSelect: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <label className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/45">
          {label}
        </label>
        {required && (
          <span className="font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#2563EB]/50">
            Required
          </span>
        )}
      </div>
      {helper && (
        <p className="text-[12px] text-[#0C1B33]/35 leading-relaxed mb-3">
          {helper}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((option) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              className={`text-left border px-4 py-3 transition-colors ${
                selected
                  ? "bg-[#EFF3FB] border-[#2563EB]/45"
                  : "bg-white border-[#0C1B33]/8 hover:border-[#0C1B33]/18"
              }`}
            >
              <span className={`font-mono-bureau text-[10px] tracking-[0.08em] uppercase ${
                selected ? "text-[#0C1B33]" : "text-[#0C1B33]/50"
              }`}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Single Select Step ──────────────────────────────────────────────

function SingleSelectStep({
  stepId,
  options,
  value,
  onSelect,
}: {
  stepId: string;
  options: { id: string; label: string; description?: string }[];
  value: string;
  onSelect: (stepId: string, value: string) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((option, i) => {
        const isSelected = value === option.id;
        return (
          <motion.button
            key={option.id}
            onClick={() => onSelect(stepId, option.id)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.3,
              delay: i * 0.04,
              ease: "easeOut",
            }}
            className={`group relative w-full text-left cursor-pointer border transition-colors duration-150 ${
              isSelected
                ? "bg-[#EFF3FB] border-[#2563EB]/40"
                : "bg-white border-[#0C1B33]/8 hover:border-[#0C1B33]/15"
            }`}
          >
            {/* Left accent bar */}
            <div
              className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors duration-150 ${
                isSelected ? "bg-[#2563EB]" : "bg-transparent"
              }`}
            />

            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex-1 min-w-0">
                <span
                  className={`font-mono-bureau text-[11px] tracking-[0.08em] uppercase block ${
                    isSelected ? "text-[#0C1B33]" : "text-[#0C1B33]/50"
                  }`}
                >
                  {option.label}
                </span>
                {option.description && (
                  <span className="text-[#0C1B33]/35 text-[12px] mt-0.5 block">
                    {option.description}
                  </span>
                )}
              </div>

              <div
                className={`w-5 h-5 border flex items-center justify-center flex-shrink-0 ${
                  isSelected
                    ? "border-[#2563EB] bg-[#2563EB]"
                    : "border-[#0C1B33]/15 bg-transparent"
                }`}
              >
                {isSelected && (
                  <Check className="w-3 h-3 text-white" strokeWidth={2.5} />
                )}
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Combobox Step (searchable dropdown + custom input) ─────────────

function ComboboxStep({
  stepId,
  options,
  value,
  onSelect,
}: {
  stepId: string;
  options: { id: string; label: string; description?: string }[];
  value: string;
  onSelect: (stepId: string, value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = query
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          o.id.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  const selectedLabel =
    options.find((o) => o.id === value)?.label || (value && value !== "skip" ? value : "");

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <input
          type="text"
          value={open ? query : selectedLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          placeholder="Search or type your industry..."
          className="w-full h-14 bg-white border border-[#0C1B33]/12 px-5 pr-12 text-[#0C1B33] text-sm placeholder:text-[#0C1B33]/30 focus:outline-none focus:border-[#2563EB]/50 focus:ring-2 focus:ring-[#2563EB]/10 font-mono-bureau tracking-wide transition-all"
        />
        <button
          onClick={() => setOpen(!open)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[#0C1B33]/30"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={open ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute z-30 w-full mt-1 bg-white border border-[#0C1B33]/10 shadow-xl max-h-64 overflow-y-auto">
          {filtered.map((option) => {
            const isSelected = value === option.id;
            return (
              <button
                key={option.id}
                onClick={() => {
                  onSelect(stepId, option.id);
                  setQuery("");
                  setOpen(false);
                }}
                className={`w-full text-left px-5 py-3 border-b border-[#0C1B33]/5 last:border-b-0 transition-colors ${
                  isSelected
                    ? "bg-[#EFF3FB]"
                    : "hover:bg-[#0C1B33]/[0.02]"
                }`}
              >
                <span
                  className={`font-mono-bureau text-[11px] tracking-[0.08em] uppercase ${
                    isSelected ? "text-[#2563EB]" : "text-[#0C1B33]/60"
                  }`}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && query && (
            <button
              onClick={() => {
                onSelect(stepId, query);
                setOpen(false);
                setQuery("");
              }}
              className="w-full text-left px-5 py-3 hover:bg-[#EFF3FB] transition-colors"
            >
              <span className="font-mono-bureau text-[11px] tracking-[0.08em] text-[#2563EB]">
                Use &ldquo;{query}&rdquo;
              </span>
              <span className="text-[#0C1B33]/30 text-[11px] block mt-0.5">
                Custom industry
              </span>
            </button>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {open && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
        />
      )}
    </div>
  );
}

// ─── Multi Select Step ───────────────────────────────────────────────

function MultiSelectStep({
  stepId,
  options,
  value,
  onToggle,
  onSetAll,
}: {
  stepId: string;
  options: { id: string; label: string }[];
  value: string[];
  onToggle: (stepId: string, value: string) => void;
  onSetAll: (stepId: string, values: string[]) => void;
}) {
  const selectableOptions = options.filter((option) => option.id !== "none-yet");
  const allSelected =
    selectableOptions.length > 0 &&
    selectableOptions.every((option) => value.includes(option.id));

  return (
    <div className="space-y-4">
      {selectableOptions.length > 1 && (
        <button
          onClick={() =>
            onSetAll(
              stepId,
              allSelected ? [] : selectableOptions.map((option) => option.id)
            )
          }
          className="inline-flex items-center gap-2 border border-[#0C1B33]/12 bg-white px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45 transition-colors hover:border-[#2563EB]/30 hover:text-[#2563EB]"
        >
          <Check className="w-3 h-3" />
          {allSelected ? "Clear all" : "Select all"}
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((option, i) => {
          const isSelected = value.includes(option.id);
          return (
            <motion.button
              key={option.id}
              onClick={() => onToggle(stepId, option.id)}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                duration: 0.25,
                delay: i * 0.03,
                ease: "easeOut",
              }}
              className={`inline-flex items-center gap-2 px-4 py-2.5 border cursor-pointer transition-all duration-150 font-mono-bureau text-[11px] tracking-[0.08em] uppercase ${
                isSelected
                  ? "bg-[#2563EB] border-[#2563EB] text-white"
                  : "bg-white border-[#0C1B33]/12 text-[#0C1B33]/50 hover:border-[#0C1B33]/25 hover:text-[#0C1B33]/70"
              }`}
            >
              {isSelected && (
                <Check className="w-3 h-3" strokeWidth={2.5} />
              )}
              {option.label}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Review Step ─────────────────────────────────────────────────────

function ReviewStep({
  wizardState,
  steps,
  isGenerating,
  onGenerate,
}: {
  wizardState: WizardState;
  steps: WizardStepConfig[];
  isGenerating: boolean;
  onGenerate: () => void;
}) {
  // Find the report type label
  const reportTypeOption = REPORT_TYPE_OPTIONS.find(
    (o) => o.id === wizardState.reportType
  );
  const generateLabel =
    wizardState.reportType === "dev-feasibility"
      ? "Generate Vacancy Report"
      : "Generate Incentive Report";

  return (
    <div>
      {/* Report type header */}
      <div className="bg-white border border-[#0C1B33]/10 p-5 mb-4">
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-2">
          Report Type
        </span>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{reportTypeOption?.icon}</span>
          <span className="font-mono-bureau text-[12px] tracking-[0.08em] uppercase text-[#0C1B33]">
            {reportTypeOption?.title}
          </span>
        </div>
      </div>

      <p className="mb-5 text-sm text-[#0C1B33]/45 leading-relaxed">
        We&apos;ll use these answers to check incentive zones, zoning, property
        context, likely programs, and next steps.
      </p>

      {/* Answer summary */}
      <div className="space-y-3 mb-8">
        {steps
          .filter((s) => s.inputType !== "report-type" && s.inputType !== "review")
          .map((step) => {
            const displayValue = getDisplayValueForStep(wizardState, step);
            if (!displayValue) return null;

            return (
              <div
                key={step.id}
                className="bg-white border border-[#0C1B33]/10 p-5"
              >
                <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-2">
                  {step.title}
                </span>
                <p className="text-[#0C1B33] text-sm">{displayValue}</p>
              </div>
            );
          })}
      </div>

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className="w-full inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-6 py-4 hover:bg-[#1d4ed8] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating Report...
          </>
        ) : (
          <>
            <FileText className="w-4 h-4" />
            {generateLabel}
          </>
        )}
      </button>
    </div>
  );
}

// ─── Comparison Summary ─────────────────────────────────────────────

function ComparisonSummary({
  reportA,
  reportB,
}: {
  reportA: GeneratedReport;
  reportB: GeneratedReport;
}) {
  const countZones = (r: GeneratedReport) => r.stackingAnalysis?.zoneCount || 0;
  const countPrograms = (r: GeneratedReport) =>
    r.sections?.reduce(
      (n, s) => n + (s.items?.filter((i) => i.programId).length || 0),
      0
    ) || 0;

  const metrics = [
    {
      label: "Mapped zones",
      a: String(countZones(reportA)),
      b: String(countZones(reportB)),
    },
    {
      label: "Address-linked programs",
      a: String(countPrograms(reportA)),
      b: String(countPrograms(reportB)),
    },
  ];

  return (
    <div className="bg-white border border-[#0C1B33]/8 mb-6">
      <div className="px-6 py-4 border-b border-[#0C1B33]/8">
        <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30">
          Side-by-Side Comparison
        </span>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr] text-center">
        {/* Header row */}
        <div className="px-4 py-3 border-b border-[#0C1B33]/6 font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30">
          Metric
        </div>
        <div className="px-4 py-3 border-b border-l border-[#0C1B33]/6 font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/50">
          {reportA.title?.replace("Incentive Report: ", "").slice(0, 30) || "Address A"}
        </div>
        <div className="px-4 py-3 border-b border-l border-[#0C1B33]/6 font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/50">
          {reportB.title?.replace("Incentive Report: ", "").slice(0, 30) || "Address B"}
        </div>
        {/* Metric rows */}
        {metrics.map((m) => (
            <div key={m.label} className="contents">
              <div className="px-4 py-3 border-b border-[#0C1B33]/4 font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 text-left">
                {m.label}
              </div>
              <div className="border-b border-l border-[#0C1B33]/4 px-4 py-3 font-editorial text-[18px] text-[#0C1B33]/70">
                {m.a}
              </div>
              <div className="border-b border-l border-[#0C1B33]/4 px-4 py-3 font-editorial text-[18px] text-[#0C1B33]/70">
                {m.b}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── Comparison Display ─────────────────────────────────────────────

function ComparisonDisplay({
  reportA,
  reportB,
  onStartOver,
  wizardState: _reportWizardState,
  isInstantMode,
  onRefineA,
  onRefineB,
}: {
  reportA: GeneratedReport;
  reportB: GeneratedReport;
  onStartOver: () => void;
  wizardState?: WizardState;
  isInstantMode?: boolean;
  onRefineA?: () => void;
  onRefineB?: () => void;
}) {
  return (
    <div className="bg-[#FAF9F6] min-h-screen py-10 px-4">
      <div className="mx-auto max-w-[1600px]">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-3">
            <div className="accent-bar" />
            <span className="font-mono-bureau text-[9px] tracking-[0.3em] uppercase text-[#0C1B33]/25">
              Location Comparison
            </span>
            <div className="accent-bar" />
          </div>
          <h1 className="font-editorial text-2xl sm:text-3xl text-[#0C1B33] mb-4">
            Side-by-Side Analysis
          </h1>
          <button
            onClick={onStartOver}
            className="inline-flex items-center gap-2 font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40 hover:text-[#0C1B33] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Start Over
          </button>
        </div>

        {/* Summary card */}
        <div className="mx-auto max-w-[850px] mb-8">
          <ComparisonSummary reportA={reportA} reportB={reportB} />
        </div>

        {/* Two reports side by side. Each card keeps a lightweight refine
            affordance — refine used to be unreachable in compare mode
            (audit RF4). */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* persona is passed EXPLICITLY, even though these panes show no
              chips (no showPersonaLens). It puts them in the renderer's
              CONTROLLED persona mode, which is what the private renderer
              they replaced did by construction: it defaulted the prop to
              DEFAULT_PERSONA and had no state or effect behind it. Omitting
              it here would drop each pane into the UNCONTROLLED mode the
              saved-report surface uses, whose mount effect reads `?persona=`
              off the URL — a lens a compare pane cannot show or escape.
              Inert today only because showPersonaLens is absent; pinned by
              report-page-live-renderer.test.tsx so it stays a decision. */}
          <ReportDisplay
            surface="live"
            report={reportA}
            onStartOver={onStartOver}
            compact
            isInstantMode={isInstantMode}
            persona={DEFAULT_PERSONA}
            onRefine={onRefineA}
            refineContext="compare_a"
          />
          <ReportDisplay
            surface="live"
            report={reportB}
            onStartOver={onStartOver}
            compact
            isInstantMode={isInstantMode}
            persona={DEFAULT_PERSONA}
            onRefine={onRefineB}
            refineContext="compare_b"
          />
        </div>
      </div>
    </div>
  );
}
