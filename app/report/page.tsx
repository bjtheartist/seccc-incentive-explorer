"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
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
  Printer,
  AlertCircle,
  ExternalLink,
  Mail,
  Link2,
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
import {
  CONFIRMED_PROGRAMS_SECTION_ID,
  normalizePublicReportForDisplay,
  SECTION_IDS,
} from "@/lib/report-engine";
import type {
  GeneratedReport,
  ReportCensusData,
  ReportContext,
  ReportZoningData,
  CorridorMetric,
  CorridorOwnerCluster,
  NeighborhoodEconomicContext,
  ReportSection,
  ReportItem,
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
import { RefineValuePanel } from "@/components/report/RefineValuePanel";
import { StartHereCard } from "@/components/report/StartHereCard";
import { ActionRoadmapSection } from "@/components/report/ActionRoadmapSection";
import {
  DownloadGateModal,
  EmailReportModal,
} from "@/components/report/ReportModals";
import {
  FreshnessBadge,
  ReportNavigationLinks,
  type ReportNavigationItem,
} from "@/components/report/ReportNavigationLinks";
import {
  ExecutiveSummarySection,
  MatchExplanationDetails,
  VerdictCard,
} from "@/components/report/ExecutiveSummarySection";
import {
  buildTableCsv,
  downloadCsv,
  slugifyFilePart,
} from "@/lib/vacancy-spreadsheet";
import { useVacancySpreadsheetSection } from "@/components/report/useVacancySpreadsheetSection";
import {
  DrawnAreaScopeUnavailableBanner,
  VacancySpreadsheetSection,
} from "@/components/report/VacancySpreadsheetSection";
import {
  AnchorCards,
  ComparisonBar,
  EconomicSignalCards,
  visibleSectionItems,
} from "@/components/report/NeighborhoodEconomics";
import type { QuickRefineFields } from "@/components/report/RefineValuePanel";
import { PersonaChips } from "@/components/report/PersonaChips";
import { applyPersonaLens, guidepostPartForSection, type GuidepostPart } from "@/lib/report-personas";
import { ContactSheet } from "@/components/report/ContactSheet";
import { ProgramCardExtras } from "@/components/report/ProgramCardExtras";
import { ReasonChips } from "@/components/report/ReasonChips";
import { ProgramCardFace } from "@/components/report/ProgramCardFace";
import {
  WhatsNotablePanel,
  ExploreByInterestPanel,
} from "@/components/report/LookingOverview";
import {
  isRealPersona,
  PersonaAlsoAtAddress,
  PersonaExecutiveSummary,
  PersonaGuidepostBand,
  PersonaReportFooter,
  PersonaReportHeader,
} from "@/components/report/PersonaReportChrome";
import {
  PersonaNeighborhoodSupplement,
  PersonaProgramSupplements,
  personaContactSectionNumber,
  personaProgramSupplementCount,
} from "@/components/report/PersonaSectionSupplements";
import { BriefStageAsk } from "@/components/report/BriefStageAsk";
import { BriefPage } from "@/components/report/BriefPage";
import {
  DEFAULT_BRIEF_UI_STATE,
  isBriefPriority,
  isBriefStage,
  type BriefUiState,
} from "@/lib/report-brief";
import {
  DEFAULT_PERSONA,
  personaFromSearch,
  personaLabel,
  personaShareParam,
  resolveInitialPersona,
  storePersona,
  type PersonaId,
} from "@/lib/personas";
import { derivePersonaLensVisible } from "@/lib/workspace";
import { GroupedReportDetail } from "@/components/report/GroupedReportDetail";
import { StartPreparationPacketButton } from "@/components/incentive-preparation/StartPreparationPacketButton";
import { ReportEmailGate } from "@/components/report/ReportEmailGate";
import { ProjectGoalSelector } from "@/components/report/ProjectGoalSelector";
import { ZoningReviewQuestions } from "@/components/zoning/ZoningReviewQuestions";
import { ZoningStarterHandoff } from "@/components/zoning/ZoningStarterHandoff";
import {
  PreparationCostBadge,
  parseDocumentCostLine,
} from "@/components/report/PreparationCostBadge";
import { InlineCrossLinkBanner } from "@/components/report/CrossLinkBanner";
import { CapitalPartnerHandoff } from "@/components/report/CapitalPartnerHandoff";
import { CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE } from "@/lib/capital-partner-report";
import {
  isSupportOrganizationSectionTitle,
  SUPPORT_ORGANIZATIONS_CAPACITY_NOTE,
  SUPPORT_ORGANIZATIONS_DESCRIPTION,
  SUPPORT_ORGANIZATIONS_SECTION_TITLE,
} from "@/lib/support-organization-copy";
import { AdminOwnershipPanel } from "@/components/report/AdminOwnershipPanel";
import type { AdminOwnershipPanelStatus } from "@/components/report/AdminOwnershipPanel";
import { fetchAdminOwnershipContext } from "@/lib/owner-file-report-context";
import type {
  OwnerFileReportMatch,
  OwnerFileReportTopCluster,
} from "@/lib/owner-file-report-context";
import { ConciergePageContextBridge } from "@/components/concierge/SiteConciergeProvider";
import { reportEmailGateKey, reportRequiresEmailGate } from "@/lib/report-email";
import { encodeWizardState, decodeWizardState } from "@/lib/url-state";
import { generateReportPdf } from "@/lib/pdf-report";
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
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import type {
  ParcelData,
  DistrictData,
  StackingRule,
  CommunityAsset,
  Stats,
} from "@/lib/types";
import ReportZoningMap from "@/components/report/ReportZoningMap";
import { cachedFetch } from "@/lib/fetch-cache";
import {
  fetchZoningLookup,
  zoningLookupKey,
} from "@/lib/zoning-lookup";
import { SaveReportModal } from "@/components/workspace/SaveReportModal";
import { storePendingReport } from "@/components/workspace/PendingReportSaver";
import { trackEvent } from "@/lib/analytics-events";
import {
  analyticsReportKey,
  createGeneratedReportEventGate,
  generatedReportEventKey,
  generatedReportEventType,
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

const fadeIn = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: "easeOut" as const },
};

function extractReportZipCode(report: GeneratedReport): string | null {
  const address = report.metadata?.address || "";
  const match = address.match(/\b(606\d{2}|60707|60827)\b/);
  return match?.[1] ?? null;
}

function reportAnalyticsPayload(
  report: GeneratedReport,
  source: string,
  metadata: Record<string, string | number | boolean | null | (string | number | boolean)[]> = {}
) {
  const zipCode = extractReportZipCode(report);
  return {
    reportType: report.reportType,
    source,
    address: report.metadata?.address ?? null,
    lat: report.metadata?.lat ?? null,
    lon: report.metadata?.lon ?? null,
    metadata: {
      reportKey: analyticsReportKey(report),
      reportTitle: report.title,
      zipCode,
      sectionCount: report.sections?.length ?? 0,
      actionCount: report.recommendedActions?.length ?? 0,
      ...metadata,
    },
  };
}

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

/**
 * Match a section by its stable id, falling back to the English title only
 * for sections saved before the `id` field existed. Renaming a section's
 * title in report-engine.ts must never change what this finds.
 */
function sectionMatchesIdOrTitle(section: ReportSection, id: string, title: string): boolean {
  return section.id ? section.id === id : section.title === title;
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
          console.error("comparison report generation failed:", error);
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
        // Stay on loading — but make the failure visible to engineering
        // instead of looking identical to "still loading" in the data (ED4).
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

  // Corridor URL mode: auto-generate a corridor report after the metric lookup completes.
  const [corridorAutoGenerated, setCorridorAutoGenerated] = useState(false);
  useEffect(() => {
    if (!isCorridorMode || corridorAutoGenerated) return;
    if (corridorLoading) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsGenerating(true);
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
  }, [isCorridorMode, corridorAutoGenerated, corridorLoading, corridorMetric, corridorOwnerClusters, reportZip, areaStats, wizardState]);

  // Share mode: auto-generate report once zones are loaded
  const [shareAutoGenerated, setShareAutoGenerated] = useState(false);
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
  }, [isShareMode, shareAutoGenerated, zones, zoneNames, censusData, cityZoning, cityZoningKey, parcelData, parcelLookupComplete, districtsData, stackingRules, communityAssets, localBusinessSupport, siteSignals, transportAccess, mobilityAccess, areaStats, corridorLoading, corridorMetric, corridorOwnerClusters, reportZip, neighborhoodEconomicsZip, neighborhoodEconomics, wizardState, hasWizardCoords]);

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
      if (!data.lat || !data.lon) throw new Error("Address not found");
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
    } catch {
      setGeocodeError("Could not find that address. Please try a more specific Chicago address.");
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
          report={report}
          onStartOver={handleStartOver}
          onRefine={handleRefine}
          onQuickRefine={handleQuickRefine}
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
                    <ReviewStep
                      wizardState={wizardState}
                      steps={steps}
                      isGenerating={isGenerating}
                      onGenerate={() => handleGenerateReport()}
                    />
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

/**
 * Compact local-support strip under the verdict — elevates the support
 * network (normally buried mid-report) to the top of the page. Clicks run
 * through the same support_resource_clicked tracking as the full section.
 */
function VerdictPartnerStrip({
  items,
  onPartnerClick,
}: {
  items: ReportItem[];
  onPartnerClick: (item: ReportItem) => void;
}) {
  if (items.length === 0) return null;
  const top = items.slice(0, 3);

  return (
    <div
      data-tour="report-support"
      className="mb-12 border border-[#0C1B33]/10 bg-[#EFF3FB]/70 px-5 py-4 print:hidden"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]">
          Local support to explore
        </span>
        <span className="text-[12px] text-[#0C1B33]/50">
          {items.length} organization{items.length !== 1 ? "s" : ""} selected for this location
        </span>
        <a
          href="#your-support-network"
          className="ml-auto font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/45 hover:text-[#2563EB] transition-colors"
        >
          See all ↓
        </a>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {top.map((item) =>
          item.url ? (
            <a
              key={item.label}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onPartnerClick(item)}
              className="inline-flex items-center gap-1.5 bg-white border border-[#0C1B33]/12 px-3 py-1.5 text-[12px] text-[#0C1B33]/75 hover:border-[#2563EB] hover:text-[#2563EB] transition-colors"
            >
              {item.label}
              <ExternalLink className="w-3 h-3 opacity-40" />
            </a>
          ) : (
            <span
              key={item.label}
              className="inline-flex items-center bg-white border border-[#0C1B33]/12 px-3 py-1.5 text-[12px] text-[#0C1B33]/70"
            >
              {item.label}
            </span>
          ),
        )}
      </div>
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
          <ReportDisplay
            report={reportA}
            onStartOver={onStartOver}
            compact
            isInstantMode={isInstantMode}
            onRefine={onRefineA}
            refineContext="compare_a"
          />
          <ReportDisplay
            report={reportB}
            onStartOver={onStartOver}
            compact
            isInstantMode={isInstantMode}
            onRefine={onRefineB}
            refineContext="compare_b"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Report Display ──────────────────────────────────────────────────

function ReportDisplay({
  report: rawReport,
  onStartOver,
  onRefine,
  onQuickRefine,
  quickRefineBusy,
  refineContext,
  isInstantMode,
  showPersonaLens,
  persona = DEFAULT_PERSONA,
  onPersonaSelect: handlePersonaSelect = () => {},
  wizardState: reportWizardState,
  compact,
  onCompare,
  compareMode,
  compareAddressInput,
  setCompareAddressInput,
  compareGeocoding,
  onCompareGeocode,
  compareGeoResult,
  analyticsSource = "instant_report",
}: {
  report: GeneratedReport;
  onStartOver: () => void;
  onRefine?: () => void;
  onQuickRefine?: (fields: QuickRefineFields) => void;
  quickRefineBusy?: boolean;
  refineContext?: "instant" | "compare_a" | "compare_b";
  isInstantMode?: boolean;
  /**
   * Persona lens visibility (Tier 1b, BM4). Deliberately decoupled from
   * isInstantMode: the page passes isInstantMode diminished by
   * hasRefinedInstantReport (hiding the refine pitch after refining is
   * intentional), but persona (audience) and goal (project outcome) are
   * orthogonal — the lens must stay available on the goal-refined report the
   * email gate funnels every real user into.
   */
  showPersonaLens?: boolean;
  /**
   * Persona lens value + committer — lifted to `ReportWizardPage`
   * (gate-persona-lens-sunset round) so `ReportEmailGate`, a SIBLING of
   * this component (not a child), can commit a persona choice into the
   * same state this component renders from. See `ReportWizardPage`'s own
   * `persona`/`handlePersonaSelect` for the owning state.
   */
  persona?: PersonaId;
  onPersonaSelect?: (next: PersonaId) => void;
  wizardState?: WizardState;
  compact?: boolean;
  onCompare?: () => void;
  compareMode?: boolean;
  compareAddressInput?: string;
  setCompareAddressInput?: (v: string) => void;
  compareGeocoding?: boolean;
  onCompareGeocode?: () => void;
  compareGeoResult?: { lat: number; lon: number; display_name: string } | null;
  /** Entry-point label used on refine/save/email instrumentation (Tier 0 audit). */
  analyticsSource?: string;
}) {
  const report = useMemo(() => normalizePublicReportForDisplay(rawReport), [rawReport]);
  const { status } = useSession();
  const [linkCopied, setLinkCopied] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const vacancy = useVacancySpreadsheetSection(report, reportWizardState, compact);
  const {
    vacancySpreadsheetScope,
    isDrawnAreaReport,
    vacancySpreadsheetLocale,
    vacancySpreadsheetError,
    isLoadingVacancySpreadsheet,
    isExportingVacancySpreadsheet,
    handleVacancySpreadsheetExport,
    vacancySpreadsheetStats,
  } = vacancy;
  const [editedSummaryText, setEditedSummaryText] = useState(
    report.executiveSummary?.whyTheseMatter || ""
  );
  // review6 S11 (CRITICAL, S1 reopened): the `programById` fallback map
  // that used to live here (built from a client-side `programs: Program[]`
  // prop) is gone. `programReportItem()` (lib/report-engine.ts) already
  // sets applicationPortals/verificationSteps/sourceUrl/status directly on
  // every program-linked report item at generation time — this was
  // always the PRIMARY source (see ReportNavigationLinks's own
  // `item.applicationPortals || program?.applicationPortals` fallback
  // ordering); losing the secondary fallback only affects a report item
  // built through some OTHER path that didn't set those fields itself.
  const viewedSupportKeyRef = useRef<string | null>(null);

  // ── Persona lens (Tier 1b, audit BM4) ──
  // Viewing lens over this snapshot: re-orders and collapses existing content
  // client-side. Canonical `report` stays untouched (save/email/PDF/refine use
  // it); only the on-screen sections + roadmap read the lensed copy.
  // `persona`/`handlePersonaSelect` (aliased from the `onPersonaSelect` prop
  // above) used to be local state + a mount effect here — moved up to
  // `ReportWizardPage` (gate-persona-lens-sunset round) so `ReportEmailGate`
  // can commit into the same value. Every OTHER reference to `persona` /
  // `handlePersonaSelect` below this point is unchanged — they're still the
  // same identifiers, just sourced from props now instead of local state.
  // Shared-link recipient experience (spec v2 deliverable 7): a framed link
  // opens in the sender's chosen lens. Derived at render time (not its own
  // state — avoids adding a useState slot, which would desync the
  // ordinal-seeded test harness; see report-page-live-renderer.test.tsx's
  // maintenance warning) from the same URL the persona-resolution effect
  // above already reads.
  const isFramedPersonaLink =
    typeof window !== "undefined" && personaFromSearch(window.location.search) !== DEFAULT_PERSONA;
  const lensed = useMemo(
    // Without visible chips there must be no invisible lens: a stored session
    // persona must never silently reorder a report that can't show the row.
    () => (showPersonaLens ? applyPersonaLens(report, persona).report : report),
    [report, persona, showPersonaLens],
  );
  const boardPersona = showPersonaLens && isRealPersona(persona) ? persona : null;
  const showPersonaView = boardPersona !== null;
  // Tracks the last guidepost PART band emitted by the section-render loop
  // below, so the Contact Sheet mount (Part 03's ONLY section on a persona
  // view — see the Part-03 correction) can emit its own band when nothing
  // in the loop already opened Part 03. Plain mutable render-scoped
  // variable, not state — recomputed fresh every render, same pattern as
  // `isFramedPersonaLink` above.
  let guidepostBandTracker: GuidepostPart | null = boardPersona === "looking" ? 1 : null;

  // ── TOC ──
  // Gate finding 19 (regression, real bug this fixes): this used to slug
  // ONLY the title (`title.toLowerCase().replace(...)`) — the rendered DOM
  // id, every TOC href, and hash-based deep-link navigation all keyed off
  // it. Gate finding 19's per-persona section-title overrides
  // (lib/report-personas.ts PERSONA_SECTION_TITLE_OVERRIDES) change
  // `section.title` at lens time — a title-only anchor would have silently
  // changed the rendered anchor id out from under every existing bookmark/
  // TOC link/deep-link the moment a persona-specific title landed, exactly
  // what "anchors are unaffected" was supposed to guarantee. Now prefers
  // the section's own stable `id` (same precedent `sectionStateKey`
  // already used for expand/collapse state — see its own comment below,
  // now folded into this one function since both need the identical
  // id-first fallback).
  const sectionToAnchor = (section: ReportSection) =>
    isSupportOrganizationSectionTitle(section.title)
      ? "your-support-network"
      : section.id ?? section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /**
   * Stable identity for a section's UI state (expand/collapse, hash-open),
   * independent of its position in the array. The persona lens reorders
   * `report.sections` (and the "Also at this address" disclosure isn't in
   * the canonical array at all), so keying state by array index — the prior
   * behavior — silently desynced whenever the active persona changed a
   * section's position (adversarial review finding #9). Now identical to
   * sectionToAnchor (both are id-first since gate finding 19) — kept as a
   * separate named function only so call sites that are conceptually about
   * "state identity" vs. "the rendered anchor" stay self-documenting.
   */
  const sectionStateKey = (section: ReportSection) => sectionToAnchor(section);
  const personaProgramsAnchor =
    lensed.sections?.find(
      (section) => !section.collapsedByPersona && section.guidepostBucket === "programs",
    )
      ? sectionToAnchor(
          lensed.sections.find(
            (section) => !section.collapsedByPersona && section.guidepostBucket === "programs",
          )!,
        )
      : "";

  // TOC derives from the LENSED report (spec v2 build order item 3): a
  // persona-reordered body with a canonical-order TOC pointed readers at the
  // wrong anchor position.
  const tocEntries = useMemo(() => {
    const entries: { label: string; anchor: string }[] = [];
    if (lensed.verdict) entries.push({ label: "Location Findings", anchor: "verdict" });
    if (lensed.executiveSummary) entries.push({ label: "Executive Summary", anchor: "executive-summary" });
    if (lensed.actionRoadmap && lensed.actionRoadmap.length > 0) entries.push({ label: "Your Next Steps", anchor: "action-roadmap" });
    if (lensed.sections) {
      for (const s of lensed.sections) {
        entries.push({ label: s.title, anchor: sectionToAnchor(s) });
      }
    }
    if (lensed.recommendedActions && lensed.recommendedActions.length > 0) entries.push({ label: "Recommended Actions", anchor: "recommended-actions" });
    if (lensed.dataSources && lensed.dataSources.length > 0) entries.push({ label: "Data Sources", anchor: "data-sources" });
    return entries;
  }, [lensed]);

  const supportSection = useMemo(
    () => report.sections?.find((section) => isSupportOrganizationSectionTitle(section.title)) ?? null,
    [report.sections]
  );

  /* ── Progressive disclosure: long-tail sections collapse by default.
        Open: the first two sections plus the primary-story sections.
        Content stays in the DOM (CSS-hidden) so print and #anchors work. ── */
  const ALWAYS_OPEN_SECTIONS = useMemo(
    () => new Set(["Programs Mapped at This Address", SUPPORT_ORGANIZATIONS_SECTION_TITLE]),
    []
  );
  // Guidepost band (spec v2 visual law): every REAL persona view reads in
  // the same fixed 3-part anatomy, never on "all". `guidepostPartForSection`
  // is a pure lookup off the already-lensed, already-ordered section — this
  // just notices when the part number changes as we walk the list and
  // drops a band in front of the section that starts the next part.
  const renderGuidepostBand = (part: GuidepostPart) => (
    <PersonaGuidepostBand key={`guidepost-part-${part}`} part={part} />
  );
  // Keyed by sectionStateKey (section.id, falling back to the title
  // anchor) — NOT array index. The persona lens reorders `lensed.sections`
  // on every persona switch; an index-keyed map silently reattached a prior
  // section's open/closed state to whatever different section now sits at
  // that position (adversarial review finding #9).
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const isSectionOpen = useCallback(
    (key: string, idx: number, title: string) =>
      expandedSections[key] ?? (idx < 2 || ALWAYS_OPEN_SECTIONS.has(title)),
    [expandedSections, ALWAYS_OPEN_SECTIONS]
  );
  useEffect(() => {
    // Auto-expand a collapsed section when a TOC/anchor link targets it.
    // Reads `lensed` (not canonical `report`) so a hash link opens the
    // section that's actually rendered under the active persona.
    const openFromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash || !lensed.sections) return;
      const target = lensed.sections.find(
        (s) => sectionToAnchor(s) === hash
      );
      if (target) setExpandedSections((prev) => ({ ...prev, [sectionStateKey(target)]: true }));
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [lensed.sections]);
  const supportItems = useMemo(
    () => supportSection?.items.slice(1) ?? [],
    [supportSection]
  );
  const supportCtaItem = useMemo(
    () => supportItems.find((item) => item.sourceUrl || item.url) ?? null,
    [supportItems],
  );
  const supportCtaUrl = supportCtaItem?.sourceUrl || supportCtaItem?.url;

  useEffect(() => {
    if (!supportSection || supportItems.length === 0) return;
    const supportViewKey = `${analyticsReportKey(report)}|support-view`;
    if (viewedSupportKeyRef.current === supportViewKey) return;
    viewedSupportKeyRef.current = supportViewKey;

    trackEvent(
      "support_resource_viewed",
      reportAnalyticsPayload(report, "report_support_network", {
        organizationCount: supportItems.length,
        organizationNames: supportItems.map((item) => item.label),
      })
    );
  }, [report, supportItems, supportSection]);

  // Refine-exposure event (Tier 0 / BM6): separate from the click event, so
  // "nobody sees the CTA" can be told apart from "sees it, doesn't click".
  const refineShownKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isInstantMode || !onRefine || compact) return;
    const shownKey = `${analyticsReportKey(report)}|refine-shown|${analyticsSource}`;
    if (refineShownKeyRef.current === shownKey) return;
    refineShownKeyRef.current = shownKey;

    trackEvent(
      "refine_cta_shown",
      reportAnalyticsPayload(report, analyticsSource, {
        isInstantMode,
      })
    );
  }, [analyticsSource, compact, isInstantMode, onRefine, report]);

  const handleRefineClick = useCallback(
    (location: "banner" | "action_row") => {
      trackEvent(
        "refine_clicked",
        reportAnalyticsPayload(report, analyticsSource, { location })
      );
      onRefine?.();
    },
    [analyticsSource, onRefine, report]
  );

  const trackSectionLinkClick = useCallback(
    (section: ReportSection, item: ReportItem) => {
      if (sectionMatchesIdOrTitle(section, CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE)) {
        trackEvent(
          "capital_partner_clicked",
          reportAnalyticsPayload(report, "report_capital_partner_section", {
            partnerId: item.partnerId || item.label,
            partnerName: item.label,
            contactMethod: "website",
          }),
        );
        return;
      }

      if (isSupportOrganizationSectionTitle(section.title)) {
        trackEvent(
          "support_resource_clicked",
          reportAnalyticsPayload(report, "report_support_network", {
            organizationName: item.label,
            organizationType: item.value || "local_support",
            contactMethod: "website",
          })
        );
        return;
      }

      if (sectionMatchesIdOrTitle(section, CONFIRMED_PROGRAMS_SECTION_ID, "Programs Mapped at This Address") || item.programId) {
        trackEvent(
          "program_link_clicked",
          reportAnalyticsPayload(report, "report_program_link", {
            programId: item.programId || item.label,
            programName: item.label,
            programLevel: item.level || null,
          })
        );
      }
    },
    [report]
  );

  const trackSupportCtaClick = useCallback(
    (item: ReportItem) => {
      trackEvent(
        "support_resource_clicked",
        reportAnalyticsPayload(report, "report_support_cta", {
          organizationName: item.label,
          organizationType: item.value || "local_support",
          contactMethod: "website",
        }),
      );
    },
    [report],
  );

  const [downloadGateOpen, setDownloadGateOpen] = useState(false);
  // The Brief (spec v2 item 5): one state slot for the two-question ask +
  // open/closed, so this only adds ONE ordinal useState slot.
  const [briefState, setBriefState] = useState<BriefUiState>(DEFAULT_BRIEF_UI_STATE);

  /* ── Admin-only ownership context (screen-only; never PDF/email — see
        components/report/AdminOwnershipPanel.tsx). Probes the Owner Files
        admin session once, then loads the private per-parcel geo export for
        this report's ZIP only when the probe confirms an admin session. ── */
  const reportZip = useMemo(() => extractReportZipCode(report), [report]);
  const [adminOwnershipStatus, setAdminOwnershipStatus] = useState<AdminOwnershipPanelStatus>("idle");
  const [adminOwnershipMatch, setAdminOwnershipMatch] = useState<OwnerFileReportMatch | null>(null);
  const [adminOwnershipTopClusters, setAdminOwnershipTopClusters] = useState<OwnerFileReportTopCluster[]>([]);

  useEffect(() => {
    if (compact || !reportZip) {
      setAdminOwnershipStatus("idle");
      return;
    }

    const controller = new AbortController();

    fetchAdminOwnershipContext({
      zip: reportZip,
      address: report.metadata?.address,
      signal: controller.signal,
      onAdminConfirmed: () => setAdminOwnershipStatus("loading"),
    })
      .then((result) => {
        setAdminOwnershipMatch(result.match);
        setAdminOwnershipTopClusters(result.topClusters);
        setAdminOwnershipStatus(result.status);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[report] admin ownership context load failed:", err);
        setAdminOwnershipStatus("error");
      });

    return () => controller.abort();
  }, [compact, reportZip, report.metadata?.address]);

  // sm_ params (additive, spec v2 item 5): a link carrying sm_stage/
  // sm_priority opens straight into the brief, skipping the ask — the
  // Brief becomes a genuinely shareable URL, not only an in-page action.
  // Effect (not a render-time read) to stay hydration-safe, matching the
  // persona-resolution effect's own pattern.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const stageParam = params.get("sm_stage");
    const priorityParam = params.get("sm_priority");
    if (isBriefStage(stageParam) && isBriefPriority(priorityParam)) {
      setBriefState({ askOpen: false, open: true, stage: stageParam, priority: priorityParam });
    }
  }, []);

  const handlePrint = () => {
    setDownloadGateOpen(true);
  };

  const handleDownloadAfterCapture = () => {
    generateReportPdf(report);
    trackEvent(
      "report_pdf_downloaded",
      reportAnalyticsPayload(report, "report_pdf_download"),
    );
    setDownloadGateOpen(false);
  };

  const handleShareReport = useCallback(() => {
    if (!reportWizardState) return;
    const encoded = encodeWizardState(reportWizardState);
    // Round-trip the persona lens so a forwarded snapshot opens in the same view.
    const personaParam = personaShareParam(persona);
    const url = `${window.location.origin}/report?${encoded}${
      personaParam ? `&persona=${personaParam}` : ""
    }`;
	    navigator.clipboard.writeText(url).then(() => {
	      setLinkCopied(true);
	      trackEvent(
	        "share_link_copied",
	        reportAnalyticsPayload(report, "report_share_link")
	      );
	      setTimeout(() => setLinkCopied(false), 2500);
	    });
	  }, [persona, report, reportWizardState]);

  // The Brief (spec v2 item 5). The backlink reuses the exact same
  // share-URL construction as handleShareReport (round-trips the persona
  // lens); `src=brief` (registered in ALLOWED_REPORT_SOURCES) attributes a
  // reader arriving at the full report from a forwarded Brief.
  const briefReportUrl = useMemo(() => {
    if (typeof window === "undefined" || !reportWizardState) return "";
    const encoded = encodeWizardState(reportWizardState);
    const personaParam = personaShareParam(persona);
    return `${window.location.origin}/report?${encoded}${
      personaParam ? `&persona=${personaParam}` : ""
    }&src=brief`;
  }, [persona, reportWizardState]);

  const handleBriefComplete = useCallback(
    (stage: BriefUiState["stage"], priority: BriefUiState["priority"]) => {
      setBriefState({ askOpen: false, open: true, stage, priority });
      trackEvent(
        "brief_generated",
        reportAnalyticsPayload(report, "report_brief", { stage, priority }),
      );
      // Reflects sm_stage/sm_priority onto the CURRENT URL (replaceState —
      // no navigation, no history-stack entry) so the address bar itself
      // becomes a shareable link straight into the open Brief.
      if (typeof window !== "undefined" && stage && priority) {
        const url = new URL(window.location.href);
        url.searchParams.set("sm_stage", stage);
        url.searchParams.set("sm_priority", priority);
        window.history.replaceState(null, "", url.toString());
      }
    },
    [report],
  );

  const handleBriefPrint = () => {
    document.body.classList.add("printing-brief");
    window.print();
    window.setTimeout(() => document.body.classList.remove("printing-brief"), 500);
  };

  const handleSaveReport = useCallback(() => {
    trackEvent(
      "save_report_clicked",
      reportAnalyticsPayload(report, analyticsSource)
    );

    if (status === "authenticated") {
      setSaveModalOpen(true);
      return;
    }

    storePendingReport({ reportData: report, wizardState: reportWizardState });
    window.location.assign(
      `/login?callbackUrl=${encodeURIComponent("/workspace?savePending=1")}`
    );
  }, [analyticsSource, report, reportWizardState, status]);

  const handleEmailReportClick = useCallback(() => {
    trackEvent(
      "email_report_clicked",
      reportAnalyticsPayload(report, analyticsSource)
    );
    setEmailDialogOpen(true);
  }, [analyticsSource, report]);

  const priorityBadge: Record<string, { label: string; classes: string }> = {
    high: {
      label: "High Priority",
      classes: "bg-[#0C1B33]/[0.06] text-[#0C1B33]/60 border border-[#0C1B33]/10",
    },
    medium: {
      label: "Medium",
      classes: "bg-[#0C1B33]/[0.03] text-[#0C1B33]/40 border border-[#0C1B33]/8",
    },
    low: {
      label: "Low",
      classes: "bg-[#0C1B33]/[0.02] text-[#0C1B33]/30 border border-[#0C1B33]/5",
    },
  };

  const formattedDate = new Date(report.generatedAt).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" }
  );

  const reportTypeLabels: Record<string, string> = {
    "site-incentives": "Site Incentive Analysis",
    "dev-feasibility": "Vacancy Analysis",
    "corridor-intelligence": "Corridor Intelligence",
    // Legacy
    "location-incentives": "Site Incentive Analysis",
    "best-location": "Vacancy Analysis",
    "program-explorer": "Program Explorer Report",
    "developer-analysis": "Developer Analysis Report",
  };
  const isVacancyReport =
    report.reportType === "dev-feasibility" ||
    report.reportType === "best-location" ||
    report.title.toLowerCase().includes("vacancy");
  const ownerOperatorSection = useMemo(
    () =>
      report.sections.find(
        (section) => sectionMatchesIdOrTitle(section, SECTION_IDS.ownerOperatorMap, "Owner & Operator Map") && section.table,
      ),
    [report.sections],
  );
  const handleOwnerOperatorExport = useCallback(() => {
    if (!ownerOperatorSection?.table) return;
    const corridorSlug = slugifyFilePart(report.metadata?.corridorLabel || report.metadata?.corridorId || "corridor");
    downloadCsv(
      buildTableCsv(ownerOperatorSection.table.columns, ownerOperatorSection.table.rows),
      `owner-operator-map-${corridorSlug}-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }, [ownerOperatorSection, report.metadata?.corridorId, report.metadata?.corridorLabel]);

  if (vacancySpreadsheetLocale && !compact) {
    return (
      <VacancySpreadsheetSection
        report={report}
        reportWizardState={reportWizardState}
        compact={compact}
        analyticsSource={analyticsSource}
        formattedDate={formattedDate}
        onStartOver={onStartOver}
        onCompare={onCompare}
        compareMode={compareMode}
        compareAddressInput={compareAddressInput}
        setCompareAddressInput={setCompareAddressInput}
        compareGeocoding={compareGeocoding}
        onCompareGeocode={onCompareGeocode}
        compareGeoResult={compareGeoResult}
        handleShareReport={handleShareReport}
        handleSaveReport={handleSaveReport}
        handlePrint={handlePrint}
        handleDownloadAfterCapture={handleDownloadAfterCapture}
        handleEmailReportClick={handleEmailReportClick}
        linkCopied={linkCopied}
        downloadGateOpen={downloadGateOpen}
        setDownloadGateOpen={setDownloadGateOpen}
        emailDialogOpen={emailDialogOpen}
        setEmailDialogOpen={setEmailDialogOpen}
        saveModalOpen={saveModalOpen}
        setSaveModalOpen={setSaveModalOpen}
        vacancy={vacancy}
      />
    );
  }

  // Section numbering offset: if exec summary exists, content sections start at 02
  const hasExecSummary = !!report.executiveSummary;
  const sectionOffset = (report.summary ? 1 : 0) + (hasExecSummary ? 1 : 0);

  return (
    <motion.div {...fadeIn}>
      {/* ── Outer wrapper: off-white background ── */}
      <div className={`report-document ${compact ? "bg-transparent py-0 px-0" : "bg-[#F5F5F0] py-4 sm:py-8 px-2 sm:px-6"} print:bg-white print:p-0`}>
        {/* ── Document ── */}
        <div className={`mx-auto ${compact ? "max-w-none" : "max-w-[850px]"} bg-white shadow-xl print:shadow-none`}>
          {/* ── Cover / Header Bar ── */}
          {boardPersona ? (
            <PersonaReportHeader
              report={report}
              persona={boardPersona}
              onSwitchToAll={() => handlePersonaSelect(DEFAULT_PERSONA)}
              compact={compact}
            />
          ) : (
          <div className={`report-cover bg-[#0C1B33] ${compact ? "px-4 pt-6 pb-5" : "px-5 sm:px-12 md:px-16 pt-12 pb-10"}`}>
            {isInstantMode && (
              <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/50 mb-2">
                Location Snapshot
              </p>
            )}
            <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/40 mb-5">
              Chicago Site Incentive Map
            </p>
            <h1 className={`font-editorial ${compact ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl lg:text-[42px]"} text-white leading-tight mb-3`}>
              {isInstantMode && report.metadata?.address
                ? `Location Snapshot — ${report.metadata.address}`
                : report.title}
            </h1>
            {report.subtitle && (
              <p className="text-white/50 text-[15px] leading-relaxed max-w-xl mb-6">
                {report.subtitle}
              </p>
            )}
            <div className="w-10 h-[3px] bg-white/30" />
          </div>
          )}

          <DrawnAreaScopeUnavailableBanner scope={vacancySpreadsheetScope} />

          {/* Refine value preview (audit RF6/WU5/BM1): explain what
              refining unlocks — goal-based organization, action plan, and gap checklist —
              with an inline goal-first quick refine. Rendered in compact
              (compare) mode too — audit RF4. The full-refine path routes
              through handleRefineClick so PR #49's refine_clicked keeps
              firing (location: banner) alongside the panel's own
              refine_value_preview_shown exposure event. */}
          {isInstantMode && !showPersonaView && (
            <RefineValuePanel
              report={report}
              context={refineContext ?? "instant"}
              onRefine={onRefine ? () => handleRefineClick("banner") : undefined}
              onQuickRefine={onQuickRefine}
              quickRefineBusy={quickRefineBusy}
              compact={compact}
            />
          )}

          {/* ── Persona lens chips (Tier 1b, BM4). Gated on showPersonaLens
              (page-level instant mode), NOT the diminished isInstantMode prop,
              so the lens survives the email gate's goal-refined report. ── */}
          {showPersonaLens && !showPersonaView && !compact && (
            <PersonaChips
              persona={persona}
              onSelect={handlePersonaSelect}
              report={report}
            />
          )}

          {/* Shared-link recipient experience (spec v2 deliverable 7): a
              framed link opened in the sender's chosen lens — say so, and
              offer the one-tap escape to the unfiltered view. */}
          {showPersonaLens && !showPersonaView && !compact && isFramedPersonaLink && persona !== DEFAULT_PERSONA && (
            <div
              data-testid="framed-persona-notice"
              className="px-5 sm:px-12 md:px-16 py-2.5 border-b border-[#0C1B33]/8 bg-[#EFF3FB] text-[11px] text-[#0C1B33]/70 flex items-center gap-2 print:hidden"
            >
              <span>
                Viewing as <strong className="font-semibold">{personaLabel(persona)}</strong> — the
                lens this link was shared with.
              </span>
              <button
                type="button"
                onClick={() => handlePersonaSelect(DEFAULT_PERSONA)}
                className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#2563EB] hover:underline cursor-pointer"
              >
                Switch to All for everything
              </button>
            </div>
          )}

          {/* ── Metadata Row ── */}
          {!showPersonaView && (
          <div className={`report-meta ${compact ? "px-4 py-3" : "px-5 sm:px-12 md:px-16 py-5"} border-b border-[#0C1B33]/8 flex flex-wrap gap-x-5 sm:gap-x-8 gap-y-3`}>
            <div>
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                Date
              </span>
              <span className="text-[#0C1B33] text-[13px]">
                {formattedDate}
              </span>
            </div>
            <div>
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                Report Type
              </span>
              <span className="text-[#0C1B33] text-[13px]">
                {reportTypeLabels[report.reportType] || report.reportType}
              </span>
            </div>
            {report.metadata?.address && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Address
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.address}
                </span>
              </div>
            )}
            {report.metadata?.industry && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Industry
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.industry}
                </span>
              </div>
            )}
            {selectedProjectGoalLabels({
              projectGoals: report.metadata?.projectGoals,
              projectType: report.metadata?.projectType,
              customGoal: report.metadata?.customGoal,
            }).length > 0 && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Project Goals
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {selectedProjectGoalLabels({
                    projectGoals: report.metadata?.projectGoals,
                    projectType: report.metadata?.projectType,
                    customGoal: report.metadata?.customGoal,
                  }).join(", ")}
                </span>
              </div>
            )}
            {report.metadata?.corridorLabel && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Geography
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.corridorLabel}
                </span>
              </div>
            )}
            {report.metadata?.zoneClass && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Zoning
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.zoneClass}
                  {report.metadata.zoneType && (
                    <span className="text-[#0C1B33]/40"> ({report.metadata.zoneType})</span>
                  )}
                </span>
              </div>
            )}
          </div>
          )}

          {!showPersonaView && !compact && (
            <AdminOwnershipPanel
              status={adminOwnershipStatus}
              zip={reportZip}
              match={adminOwnershipMatch}
              topClusters={adminOwnershipTopClusters}
            />
          )}

          {!showPersonaView && (
            <CapitalPartnerHandoff
              report={report}
              source={analyticsSource}
              compact={compact}
            />
          )}

          {!showPersonaView && supportItems.length > 0 && !compact && (
            <div className="px-5 sm:px-12 md:px-16 py-5 border-b border-[#0C1B33]/8 bg-[#FAF9F6]">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/60 mb-1.5">
                    Local support organizations
                  </div>
                  <h2 className="font-editorial text-[22px] text-[#0C1B33] leading-snug">
                    {SUPPORT_ORGANIZATIONS_SECTION_TITLE}
                  </h2>
                  <p className="text-[#0C1B33]/45 text-[13px] leading-relaxed mt-1.5 max-w-2xl">
                    {SUPPORT_ORGANIZATIONS_DESCRIPTION}
                  </p>
                  <p className="text-[#0C1B33]/35 text-[11px] leading-relaxed mt-1.5 max-w-2xl">
                    {SUPPORT_ORGANIZATIONS_CAPACITY_NOTE}
                  </p>
                  <p className="font-mono-bureau text-[9px] tracking-[0.08em] text-[#0C1B33]/30 mt-2 truncate">
                    {supportItems.length} selected · {supportItems.slice(0, 3).map((item) => item.label).join(" · ")}
                    {supportItems.length > 3 ? " · more below" : ""}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 md:justify-end">
                  {supportCtaItem && supportCtaUrl && (
                    <a
                      href={supportCtaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackSupportCtaClick(supportCtaItem)}
                      className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[9px] tracking-[0.14em] uppercase px-4 py-3 hover:bg-[#0C1B33]/80 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Visit {supportCtaItem.label}
                    </a>
                  )}
                  <a
                    href="#your-support-network"
                    className="inline-flex items-center justify-center gap-2 border border-[#0C1B33]/12 bg-white text-[#0C1B33]/55 font-mono-bureau text-[9px] tracking-[0.14em] uppercase px-4 py-3 hover:border-[#0C1B33]/25 hover:text-[#0C1B33] transition-colors"
                  >
                    See all organizations
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* ── Table of Contents ── */}
          {!showPersonaView && tocEntries.length > 0 && (
            <nav className="px-5 sm:px-12 md:px-16 pt-8 pb-2">
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/25 block mb-3">
                Contents
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                {tocEntries.map((entry, i) => (
                  <a
                    key={entry.anchor}
                    href={`#${entry.anchor}`}
                    className="flex items-baseline gap-2 group py-0.5"
                  >
                    <span className="font-mono-bureau text-[9px] text-[#0C1B33]/15 w-5 text-right flex-shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-mono-bureau text-[10px] tracking-[0.05em] text-[#0C1B33]/45 group-hover:text-[#0C1B33] transition-colors">
                      {entry.label}
                    </span>
                  </a>
                ))}
              </div>
            </nav>
          )}

          {/* ── Zoning Map ── */}
          {!showPersonaView && report.metadata?.lat != null && report.metadata?.lon != null && (
            <div className="px-5 sm:px-12 md:px-16 pt-8">
              <ReportZoningMap
                lat={report.metadata.lat}
                lon={report.metadata.lon}
                address={report.metadata?.address}
              />
            </div>
          )}

          {/* ── Report Body ── */}
          <div className={`report-body ${compact ? "px-4 py-8" : "px-5 sm:px-12 md:px-16 py-14"}`}>
            {showPersonaView && boardPersona && (
              <>
                {boardPersona === "looking" && renderGuidepostBand(1)}
                <PersonaExecutiveSummary
                  report={boardPersona === "looking" ? report : lensed}
                  programsAnchor={personaProgramsAnchor}
                  sectionNumber={boardPersona === "looking" ? "01" : undefined}
                />
              </>
            )}
            {/* ── Start Here (Phase B of the startHere consolidation): the
                canonical one-action card, first content block in the body.
                Absent on reports without report.startHere (older saved
                reports, or report types outside the executive-summary
                gate) — the rest of the body renders unchanged either way. ── */}
            {!showPersonaView && <StartHereCard report={report} source={analyticsSource} />}

            {/* ── Overview text ── */}
            {!showPersonaView && report.summary && (
              <div className="mb-12">
                <p className="text-[#0C1B33]/60 text-[15px] leading-[1.8] max-w-prose">
                  {report.summary}
                </p>
              </div>
            )}

            {!compact && !showPersonaView && vacancySpreadsheetLocale && (
              <div className="mb-12 border border-[#0C1B33]/8 bg-[#FAF9F6] p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
                  <div className="min-w-0">
                    <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#0C1B33]/30 mb-2">
                      Vacancy Spreadsheet
                    </div>
                    <h2 className="font-editorial text-[24px] text-[#0C1B33] mb-2">
                      Vacant properties in {vacancySpreadsheetLocale}
                    </h2>
                    <p className="text-[#0C1B33]/45 text-[13px] leading-relaxed max-w-prose">
                      This vacancy report pulls the locale-level property spreadsheet so the analysis can move from summary findings to specific sites that may need review, outreach, or follow-up.
                    </p>
                  </div>
                  <button
                    onClick={handleVacancySpreadsheetExport}
                    disabled={isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet}
                    className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-5 py-3 hover:bg-[#0C1B33]/80 disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer"
                  >
                    {isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    Download CSV
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#0C1B33]/8 mt-6">
                  {[
                    ["Properties", isLoadingVacancySpreadsheet ? "Loading" : vacancySpreadsheetStats.total.toLocaleString()],
                    ["Vacant land", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.land.toLocaleString()],
                    ["Buildings", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.buildings.toLocaleString()],
                    ["Public ownership", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.publicOwnership.toLocaleString()],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-white px-4 py-3">
                      <span className="font-mono-bureau text-[8px] tracking-[0.18em] uppercase text-[#0C1B33]/25 block mb-1">
                        {label}
                      </span>
                      <span className="font-mono-bureau text-[16px] text-[#0C1B33]/70">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                {vacancySpreadsheetError && (
                  <p className="mt-4 text-[12px] text-red-600/70">
                    {vacancySpreadsheetError}
                  </p>
                )}
              </div>
            )}

            {/* ── Verdict Card ── */}
            {!showPersonaView && report.verdict && (
              <div id="verdict">
                <VerdictCard verdict={report.verdict} />
              </div>
            )}

            {/* ── Who can help — support network elevated to the top ── */}
            {!showPersonaView && supportSection && supportItems.length > 0 && (
              <VerdictPartnerStrip
                items={supportItems}
                onPartnerClick={(item) =>
                  trackSectionLinkClick(supportSection, item)
                }
              />
            )}

            {/* ── Executive Summary from Confidence Engine ── */}
            {!showPersonaView && report.executiveSummary && (
              <div id="executive-summary">
                <ExecutiveSummarySection
                  summary={report.executiveSummary}
                  isEditing={isEditingSummary}
                  editedText={editedSummaryText}
                  onToggleEdit={() => setIsEditingSummary(!isEditingSummary)}
                  onTextChange={setEditedSummaryText}
                  collapseTopActions={Boolean(report.startHere)}
                />
              </div>
            )}

            {/* Action-first hierarchy: orient the user before detailed evidence. */}
            {!showPersonaView && lensed.actionRoadmap && lensed.actionRoadmap.length > 0 && (
              <div id="action-roadmap">
                <ActionRoadmapSection
                  items={lensed.actionRoadmap}
                  onContactClick={(item, contactMethod) =>
                    trackEvent(
                      "support_resource_clicked",
                      reportAnalyticsPayload(report, "action_roadmap", {
                        organizationName: item.contact?.agency || item.programName || item.label,
                        organizationType: item.contact?.role || "program_contact",
                        contactMethod,
                        programId: item.programId || null,
                        programName: item.programName || null,
                      })
                    )
                  }
                />
              </div>
            )}

            {/* ── Content Sections ── */}
            {(() => {
              let personaSectionCounter = boardPersona === "looking" ? 1 : 0;
              const personaAlsoSection = lensed.sections?.find((section) => section.collapsedByPersona);
              return lensed.sections?.flatMap((section, sectionIdx) => {
                // Part-03 correction (late owner amendment, binding — supersedes
                // the earlier "additive" ContactSheet build): on a real persona
                // lens, Part 03 contains EXACTLY ONE section — the Contact
                // Sheet. The raw support-organizations section is suppressed
                // here; its orgs still reach the reader, lane-ranked and
                // why-lined, as ContactSheet rows below. "All" is untouched —
                // switching to it always shows the full, un-consolidated list.
                if (
                  isSupportOrganizationSectionTitle(section.title) &&
                  showPersonaView
                ) {
                  return [];
                }
                if (showPersonaView && section.collapsedByPersona) return [];

                const sectionNumber = showPersonaView
                  ? String(++personaSectionCounter).padStart(2, "0")
                  : String(sectionIdx + sectionOffset + 1).padStart(2, "0");
                const sectionKey = sectionStateKey(section);
                const guidepostPart = showPersonaView
                  ? guidepostPartForSection(section, persona)
                  : null;
                const band =
                  guidepostPart !== null && guidepostPart !== guidepostBandTracker
                    ? renderGuidepostBand(guidepostPart)
                    : null;
                guidepostBandTracker = guidepostPart;

                // Persona lens: the "Also at this address" group defaults to
                // collapsed (still user-expandable, still in the DOM for print/
                // anchors — collapse, never hide).
                const sectionOpen = showPersonaView
                  ? true
                  : section.collapsedByPersona
                  ? (expandedSections[sectionKey] ?? false)
                  : isSectionOpen(sectionKey, sectionIdx, section.title);
                const isPersonaProgramSection =
                  showPersonaView && section.guidepostBucket === "programs";
                const isPersonaFactSection =
                  showPersonaView &&
                  ["siteFacts", "logisticsAccess", "civicRepresentation", "zoning"].includes(
                    section.guidepostBucket ?? "",
                  );

                const sectionElement = (
                  <div
                    key={sectionKey}
                    id={sectionToAnchor(section)}
                    data-persona-section-open={showPersonaView ? sectionOpen : undefined}
                    className={`report-section ${
                      showPersonaView
                        ? "mb-0 border-b border-[#D8DDE6] py-4"
                        : sectionOpen
                          ? "mb-14"
                          : "report-section-collapsed mb-6"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (showPersonaView) return;
                        setExpandedSections((prev) => ({
                          ...prev,
                          [sectionKey]: !sectionOpen,
                        }));
                        trackEvent("section_expanded", {
                          reportType: report.reportType,
                          source: "report_section_toggle",
                          metadata: {
                            sectionId: sectionToAnchor(section),
                            sectionTitle: section.title,
                            sectionIndex: sectionIdx,
                            state: sectionOpen ? "collapsed" : "expanded",
                          },
                        });
                      }}
                      aria-expanded={sectionOpen}
                      className={`section-head group mb-4 flex w-full items-baseline text-left ${showPersonaView ? "gap-2.5 cursor-default" : "gap-4 cursor-pointer print:cursor-auto"}`}
                    >
                      <span className={showPersonaView ? "font-mono-bureau text-[10px] text-[#2563EB]" : "font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8"}>
                        {sectionNumber}
                      </span>
                      <h2 className={showPersonaView ? "font-editorial text-[15.5px] font-semibold normal-case tracking-normal text-[#0C1B33]" : "font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]"}>
                        {section.title}
                      </h2>
                      {!showPersonaView && <span className="ml-auto font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30 group-hover:text-[#2563EB] transition-colors print:hidden">
                        {sectionOpen
                          ? "Collapse"
                          : `Expand${section.items?.length ? ` · ${section.items.length}` : ""}`}
                      </span>}
                    </button>
	                    {!showPersonaView && section.description && (
	                      <p className="text-[#0C1B33]/35 text-[13px] leading-relaxed mb-6 max-w-prose">
	                        {section.description}
	                      </p>
	                    )}
                    {showPersonaView &&
                      isPersonaProgramSection &&
                      visibleSectionItems(section).length === 0 &&
                      section.description && (
                        <p className="mb-4 max-w-prose text-[12.5px] leading-relaxed text-[#5A6478]">
                          {section.description}
                        </p>
                      )}

                    {sectionMatchesIdOrTitle(section, SECTION_IDS.ownerOperatorMap, "Owner & Operator Map") && section.table && (
                      <div className="mb-5">
                        <button
                          type="button"
                          onClick={handleOwnerOperatorExport}
                          className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-4 py-2.5 hover:bg-[#0C1B33]/80 transition-colors cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Download Owner / Operator CSV
                        </button>
                      </div>
                    )}

	                    {section.table && section.table.rows.length > 0 && (
	                      <div className="border border-[#0C1B33]/8 overflow-x-auto mb-8">
	                        <table className="w-full min-w-[680px] text-left text-[12px]">
	                          <thead className="bg-[#0C1B33]/[0.03]">
	                            <tr>
	                              {section.table.columns.map((column) => (
	                                <th
	                                  key={column}
	                                  className="px-4 py-3 font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/35"
	                                >
	                                  {column}
	                                </th>
	                              ))}
	                            </tr>
	                          </thead>
	                          <tbody className="divide-y divide-[#0C1B33]/5">
	                            {section.table.rows.map((row, rowIndex) => (
	                              <tr key={rowIndex}>
	                                {row.map((cell, cellIndex) => (
	                                  <td
	                                    key={`${rowIndex}-${cellIndex}`}
	                                    className={`px-4 py-3 align-top ${
	                                      cellIndex === 0
	                                        ? "font-medium text-[#0C1B33]/75"
	                                        : "text-[#0C1B33]/45"
	                                    }`}
	                                  >
	                                    {cell}
	                                  </td>
	                                ))}
	                              </tr>
	                            ))}
	                          </tbody>
	                        </table>
	                      </div>
	                    )}

	                    {/* Neighborhood Economic Context comparison bars */}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.neighborhoodEconomicContext, "Neighborhood Economic Context") && report.marketContext?.comparisons && (
                      <div className="space-y-0 divide-y divide-[#0C1B33]/5 mb-6">
                        {report.marketContext.comparisons.income && (
                          <ComparisonBar
                            label="Median Household Income"
                            locationFormatted={`$${report.marketContext.comparisons.income.location.toLocaleString()}`}
                            cityFormatted={`$${report.marketContext.comparisons.income.city.toLocaleString()}`}
                            pct={report.marketContext.comparisons.income.pct}
                          />
                        )}
                        {report.marketContext.comparisons.homeValue && (
                          <ComparisonBar
                            label="Median Home Value"
                            locationFormatted={`$${report.marketContext.comparisons.homeValue.location.toLocaleString()}`}
                            cityFormatted={`$${report.marketContext.comparisons.homeValue.city.toLocaleString()}`}
                            pct={report.marketContext.comparisons.homeValue.pct}
                          />
                        )}
                        {report.marketContext.comparisons.population && (
                          <ComparisonBar
                            label="Tract Population"
                            locationFormatted={report.marketContext.comparisons.population.location.toLocaleString()}
                            cityFormatted={`${report.marketContext.comparisons.population.city.toLocaleString()} avg`}
                            pct={report.marketContext.comparisons.population.pct}
                          />
                        )}
                        {report.marketContext.comparisons.walkScore && (
                          <ComparisonBar
                            label="EPA Walkability Index"
                            locationFormatted={`${report.marketContext.comparisons.walkScore.location}/20`}
                            cityFormatted={`${report.marketContext.comparisons.walkScore.city}/20`}
                            pct={report.marketContext.comparisons.walkScore.pct}
                          />
                        )}
                      </div>
                    )}

                    {/* Neighborhood economic signal cards */}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.neighborhoodEconomicContext, "Neighborhood Economic Context") && report.neighborhoodEconomics && (
                      <EconomicSignalCards economics={report.neighborhoodEconomics} />
                    )}

                    {showPersonaView &&
                      boardPersona &&
                      section.guidepostBucket === "neighborhoodContext" && (
                        <PersonaNeighborhoodSupplement
                          report={report}
                          persona={boardPersona}
                        />
                      )}

                    {/* Local Impact Anchors — dedicated section, card layout */}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.localImpactAnchors, "Local Impact Anchors") && report.neighborhoodEconomics?.anchors && (
                      <AnchorCards anchors={report.neighborhoodEconomics.anchors} />
                    )}

                    {/* Factual zone coverage and program interactions */}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.incentiveZoneCoverage, "Incentive Zone Coverage & Program Interactions") && report.stackingAnalysis && (
                      <div className="mb-8">
                        <div className="mb-6 border-l-2 border-[#2563EB]/25 pl-4">
                          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/35">
                            Mapped zone coverage
                          </span>
                          <p className="mt-1 text-[13px] text-[#0C1B33]/60">
                            {report.stackingAnalysis.zoneCount} incentive zone{report.stackingAnalysis.zoneCount === 1 ? "" : "s"} intersect this address.
                          </p>
                        </div>

                        {/* Program interaction table */}
                        {(report.stackingAnalysis.combinations.length > 0 || report.stackingAnalysis.rules.length > 0) && (
                          <div className="border border-[#0C1B33]/8 overflow-hidden">
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="bg-[#0C1B33]/[0.03]">
                                  <th className="text-left font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 px-4 py-2.5">Programs</th>
                                  <th className="text-left font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 px-4 py-2.5 w-24">Next step</th>
                                  <th className="text-left font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 px-4 py-2.5 hidden sm:table-cell">What to confirm</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#0C1B33]/5">
                                {report.stackingAnalysis.combinations.map((combo, ci) => (
                                  <tr key={`combo-${ci}`}>
                                    <td className="px-4 py-3 text-[#0C1B33]/70 font-medium">{combo.zones.join(" + ")}</td>
                                    <td className="px-4 py-3">
                                      <span className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#0C1B33]/50 bg-[#0C1B33]/[0.04] px-2 py-0.5">
                                        Verify
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-[#0C1B33]/40 hidden sm:table-cell">{combo.benefit}</td>
                                  </tr>
                                ))}
                                {report.stackingAnalysis.rules.map((rule, ri) => (
                                  <tr key={`rule-${ri}`}>
                                    <td className="px-4 py-3 text-[#0C1B33]/70 font-medium">{rule.programA} + {rule.programB}</td>
                                    <td className="px-4 py-3">
                                      <span className="bg-[#0C1B33]/[0.04] px-2 py-0.5 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
                                        Verify
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-[#0C1B33]/40 hidden sm:table-cell">{rule.reason}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {visibleSectionItems(section).length > 0 && (
                      <div className={isPersonaFactSection ? "grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3" : "space-y-0 divide-y divide-[#0C1B33]/5"}>
                        {visibleSectionItems(section).map((item, itemIdx) => {
                          const reportItem = item as ReportNavigationItem;
                          const isSupportNetworkItem = isSupportOrganizationSectionTitle(section.title);
                          const isDeadlineItem = sectionMatchesIdOrTitle(section, SECTION_IDS.upcomingDeadlines, "Upcoming Deadlines Near This Address");
                          const supportWebsiteUrl = isSupportNetworkItem ? (reportItem.sourceUrl || reportItem.url) : undefined;
                          const hasGroupedDetail = Boolean(item.detailGroups?.length);
                          const hasSideValue = Boolean(item.value && !hasGroupedDetail);
                          // Gate round 3 BLOCKER 11 RULING: real program items'
                          // `item.detail` (== program.summary) now renders as
                          // ProgramCardFace's "What it funds" block instead of
                          // here, matching the board's sequence — suppressed
                          // below so it never renders in both places on one
                          // card. `programId` is set on every ReportItem
                          // programReportItem() builds, regardless of section.
                          const isProgramCardItem = Boolean(item.programId);
                          const isPersonaProgramSibling =
                            isPersonaProgramSection && itemIdx > 0;
                          // review6 S11 (CRITICAL, S1 reopened): the `itemProgram`
                          // fallback (a client-side `Program` lookup) is gone —
                          // `reportItem.*` alone, which programReportItem()
                          // (lib/report-engine.ts) already sets at generation
                          // time, is now the only source.
                          const hasNavigationLinks = Boolean(
                            reportItem.sourceUrl ||
                            reportItem.applicationPortals?.length ||
                            reportItem.verificationSteps?.length,
                          );

                          return (
                            <div
                              key={itemIdx}
                              className={`report-item ${isPersonaFactSection ? "py-1" : "py-5 first:pt-0 sm:py-6"} ${
                                isPersonaProgramSection && itemIdx === 0
                                  ? "my-3 border-2 border-[#2563EB] bg-white px-4 sm:px-5"
                                  : ""
                              }`}
                            >
                            <div className={`grid grid-cols-1 ${isPersonaFactSection ? "gap-1" : "gap-3"} ${hasSideValue && !isPersonaFactSection ? "sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-x-10" : ""}`}>
                              {/* Left: label */}
                              <div className="flex-1 min-w-0">
                                <span className={isPersonaFactSection ? "flex flex-wrap items-center gap-2 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#5A6478]" : "flex flex-wrap items-center gap-2 text-[#0C1B33] text-[13px] sm:text-[14px] font-semibold"}>
                                  {supportWebsiteUrl ? (
                                    <a
                                      href={supportWebsiteUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 hover:text-[#2F5BEA] transition-colors print-url"
                                    >
                                      {item.label}
                                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                    </a>
                                  ) : (
                                    item.label
                                  )}
                                  {item.level && (
                                    <span className="font-mono-bureau text-[8px] sm:text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/25 ml-2 font-normal">
                                      {item.level}
                                    </span>
                                  )}
                                  {item.preparationCost && <PreparationCostBadge signal={item.preparationCost} />}
                                </span>
                                {!isPersonaFactSection && !isProgramCardItem && !hasGroupedDetail && item.detail && sectionMatchesIdOrTitle(section, SECTION_IDS.requiredDocuments, "Required Documents") ? (
                                  <ul className="mt-2 space-y-1.5">
                                    {item.detail.split("\n").map((line, li) => {
                                      const { documentName, programs, cost } = parseDocumentCostLine(line);
                                      return (
                                        <li key={li} className="flex items-start gap-2 text-[11px] sm:text-[12px] leading-relaxed">
                                          <span className="text-[#0C1B33]/15 mt-0.5 flex-shrink-0">&bull;</span>
                                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[#0C1B33]/55">
                                            <span>{documentName}</span>
                                            {cost && <PreparationCostBadge signal={cost} label="Prep" />}
                                            {programs && (
                                              <span className="text-[#0C1B33]/25 ml-1.5">— {programs}</span>
                                            )}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : !isPersonaFactSection && !isProgramCardItem && !hasGroupedDetail && item.detail ? (
                                  <span className={`mt-1.5 block text-[12px] leading-[1.65] text-[#0C1B33]/50 sm:text-[13px] ${isSupportNetworkItem || isDeadlineItem || sectionMatchesIdOrTitle(section, CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE) ? "whitespace-pre-line" : ""}`}>
                                    {item.detail}
                                  </span>
                                ) : null}
                              </div>

                              {/* Right: value */}
                              {hasSideValue && (
                                <span className={isPersonaFactSection ? "min-w-0 break-words text-[12.5px] leading-[1.45] text-[#0C1B33]" : "min-w-0 break-words font-mono-bureau text-[11px] leading-[1.7] text-[#0C1B33]/50 sm:text-[12px]"}>
                                  {item.value}
                                </span>
                              )}
                            </div>

                            {!isPersonaFactSection && hasGroupedDetail && item.detailGroups && (
                              <GroupedReportDetail
                                summary={item.value}
                                groups={item.detailGroups}
                                caveat={item.detailCaveat}
                              />
                            )}

                            {/* Gate finding 11 + gate round 2 BLOCKER 11 + gate round 3
                                BLOCKER 11 RULING: ALL "blessed" card content lives on
                                the FACE, in the BOARD's exact sequence (the board wins
                                over spec v2 prose per the round-3 ruling) — header
                                (administrator/status/window pills), glance row, cost
                                signals, "What it funds," Commonly required (all
                                ProgramCardFace), then reason chips labeled "Why this
                                is shown" (ReasonChips), then Can combine with,
                                next-step+contact, What to expect, Verify at the source
                                + the traces-to-public-record line (all
                                ProgramCardExtras — moved OUT of the accordion below
                                entirely). Same source data throughout — only
                                where/how it renders changed. See ProgramCardFace.tsx's
                                and ProgramCardExtras.tsx's own header comments for the
                                full board-order rationale, and
                                lib/__tests__/refine-tier1.test.ts's real render-order
                                test for the enforcing proof. */}
                            {!isSupportNetworkItem && !isPersonaProgramSibling && (
                              <>
                                <ProgramCardFace item={item} />
                                <ReasonChips explanation={item.matchExplanation} />
                                <ProgramCardExtras item={item} />
                              </>
                            )}
                            {isPersonaProgramSibling && (
                              <ReasonChips explanation={item.matchExplanation} />
                            )}

                            {/* Genuinely supplementary detail only — the deeper
                                match-explanation facts (public data, your answers,
                                still to confirm, documents to gather, confirm-with)
                                and official navigation. */}
                            {!showPersonaView && !isSupportNetworkItem && (item.matchExplanation || item.url || hasNavigationLinks) && (
                              <Accordion type="single" collapsible className="mt-3 sm:mt-4">
                                <AccordionItem value="program-review" className="border-none">
                                  <AccordionTrigger className="py-2 hover:no-underline font-mono-bureau text-[9px] tracking-[0.1em] text-[#0C1B33]/40 uppercase">
                                    Program review details
                                  </AccordionTrigger>
                                  <AccordionContent className="report-eligibility pl-4 border-l border-[#0C1B33]/8 space-y-2">
                                    <MatchExplanationDetails explanation={item.matchExplanation} />
                                    {item.url && (
	                                      <a
	                                        href={item.url}
	                                        target="_blank"
	                                        rel="noopener noreferrer"
	                                        onClick={() => trackSectionLinkClick(section, item)}
	                                        className="inline-flex items-center gap-1.5 text-[11px] text-[#0C1B33]/50 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide print-url"
	                                      >
                                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                        More information
                                      </a>
                                    )}
                                    <ReportNavigationLinks item={reportItem} />
                                    {item.lastVerifiedAt && (
                                      <FreshnessBadge lastVerifiedAt={item.lastVerifiedAt} isStale={item.isStale} />
                                    )}
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}
                    {isPersonaProgramSection && personaAlsoSection && (
                      <PersonaAlsoAtAddress items={personaAlsoSection.items} />
                    )}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.zoningUseStartingPoint, "Zoning & Use Starting Point") && report.metadata?.zoneClass && (
                      <>
                        {/* Owner ruling A2: every view — the kitchen sink AND
                            every persona lens — gets the district family +
                            authority line next to the published code. zoneClass
                            never renders without this detail. */}
                        <ZoningStarterHandoff
                          zoneClass={report.metadata.zoneClass}
                          siteSpecificOrdinanceUrl={section.items.find((item) => item.label === "City Zoning Classification")?.url}
                        />
                        {/* Owner ruling A3 (amended): the activity questionnaire
                            — and its one-pager handoff button — is excluded
                            from every persona lens, present only on "all". */}
                        {(!showPersonaLens || persona === DEFAULT_PERSONA) && (
                          <div className="mt-8 print:hidden">
                            <ZoningReviewQuestions
                              zoneClass={report.metadata.zoneClass}
                              siteSpecificOrdinanceUrl={section.items.find((item) => item.label === "City Zoning Classification")?.url}
                              address={report.metadata.address}
                              businessType={report.metadata.industry ?? report.metadata.proposedUse}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
                const supplements =
                  isPersonaProgramSection && boardPersona
                    ? (
                        <PersonaProgramSupplements
                          key={`${sectionKey}-supplements`}
                          report={report}
                          lensedReport={lensed}
                          persona={boardPersona}
                          firstSectionNumber={personaSectionCounter + 1}
                        />
                      )
                    : null;
                if (isPersonaProgramSection && boardPersona) {
                  personaSectionCounter += personaProgramSupplementCount(boardPersona);
                }
                return [band, sectionElement, supplements].filter(Boolean);
              });
            })()}

            {boardPersona === "looking" && (
              <>
                {renderGuidepostBand(2)}
                <WhatsNotablePanel report={report} sectionNumber="03" />
                {renderGuidepostBand(3)}
                <ExploreByInterestPanel
                  report={report}
                  sectionNumber="04"
                  fullPictureSectionNumber="05"
                />
              </>
            )}

            {boardPersona && boardPersona !== "looking" && (
              <>
                {renderGuidepostBand(3)}
                <ContactSheet
                  report={lensed}
                  persona={boardPersona}
                  sectionNumber={personaContactSectionNumber(boardPersona)}
                />
              </>
            )}

            {/* ── Recommended Actions ──
                Demoted behind native disclosure when report.startHere is
                present — StartHereCard already surfaced the one dominant
                action at the top of the body, so this list (still every
                action, unchanged content) collapses instead of competing
                with it. Absent report.startHere, this renders exactly as
                before. */}
            {!showPersonaView && report.recommendedActions &&
              report.recommendedActions.length > 0 && (() => {
                const sectionNumber = String(
                  (report.sections?.length || 0) + sectionOffset + 1
                ).padStart(2, "0");
                const actionsList = (
                  <div className="space-y-5">
                    {report.recommendedActions.map((action, actionIdx) => {
                      const priority = action.priority || "medium";
                      const badge =
                        priorityBadge[priority] || priorityBadge.medium;

                      return (
                        <div key={actionIdx} className="flex items-start gap-4">
                          {/* Number */}
                          <span className="font-editorial text-[18px] sm:text-[22px] leading-none text-[#0C1B33]/15 flex-shrink-0 w-6 sm:w-7 text-right pt-0.5">
                            {actionIdx + 1}.
                          </span>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start sm:items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                              <span className="text-[#0C1B33] text-[13px] sm:text-[14px] font-semibold">
                                {action.label}
                              </span>
                              <span
                                className={`font-mono-bureau text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 rounded-sm ${badge.classes}`}
                              >
                                {badge.label}
                              </span>
                              {action.preparationCost && <PreparationCostBadge signal={action.preparationCost} />}
                            </div>
                            {action.description && (
                              <p className="text-[#0C1B33]/45 text-[13px] leading-relaxed">
                                {action.description}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );

                return report.startHere ? (
                  <details id="recommended-actions" className="mb-12 group">
                    <summary className="flex items-baseline gap-4 mb-4 cursor-pointer select-none list-none">
                      <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                        {sectionNumber}
                      </span>
                      <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                        Recommended Actions · {report.recommendedActions.length}
                      </h2>
                    </summary>
                    <hr className="border-[#0C1B33]/8 mb-5" />
                    {actionsList}
                  </details>
                ) : (
                  <div id="recommended-actions" className="mb-12">
                    <div className="flex items-baseline gap-4 mb-4">
                      <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                        {sectionNumber}
                      </span>
                      <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                        Recommended Actions
                      </h2>
                    </div>
                    <hr className="border-[#0C1B33]/8 mb-5" />
                    {actionsList}
                  </div>
                );
              })()}

            {/* ── Data Sources ── */}
            {!showPersonaView && report.dataSources && report.dataSources.length > 0 && (
              <div id="data-sources" className="mb-12">
                <div className="flex items-baseline gap-4 mb-4">
                  <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                    {String(
                      (report.sections?.length || 0) + sectionOffset + (report.recommendedActions && report.recommendedActions.length > 0 ? 2 : 1)
                    ).padStart(2, "0")}
                  </span>
                  <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                    Data Sources
                  </h2>
                </div>
                <hr className="border-[#0C1B33]/8 mb-5" />
                <p className="text-[#0C1B33]/35 text-[13px] leading-relaxed mb-5 max-w-prose">
                  This report cites the sources used to show mapped screening signals and location context.
                </p>
                <ul className="space-y-3">
                  {report.dataSources.map((src) => (
                    <li key={src.id} className="text-[13px] leading-relaxed">
                      <span className="text-[#0C1B33]/70 font-semibold">{src.label}</span>
                      <span className="text-[#0C1B33]/40"> — {src.description}</span>
                      {src.url && (
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 ml-2 text-[11px] text-[#0C1B33]/40 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide print-url"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          Link
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Government Resources ── */}
            {!showPersonaView && <div className="mt-16 pt-8 border-t border-[#0C1B33]/8">
              <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-5">
                Government Resources
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <p className="text-[#0C1B33]/70 text-[13px] font-semibold mb-1">City of Chicago</p>
                  <p className="text-[#0C1B33]/40 text-[12px] leading-relaxed mb-1.5">
                    Dept. of Planning &amp; Development
                  </p>
                  <p className="text-[#0C1B33]/40 text-[11px] leading-relaxed">
                    <a href="tel:+13127444190" className="hover:text-[#0C1B33] transition-colors print-url">(312) 744-4190</a>
                  </p>
                  <a
                    href="https://www.chicago.gov/city/en/depts/dcd.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0C1B33]/35 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide mt-1 print-url"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    chicago.gov/dcd
                  </a>
                </div>
                <div>
                  <p className="text-[#0C1B33]/70 text-[13px] font-semibold mb-1">Cook County</p>
                  <p className="text-[#0C1B33]/40 text-[12px] leading-relaxed mb-1.5">
                    Bureau of Economic Development
                  </p>
                  <p className="text-[#0C1B33]/40 text-[11px] leading-relaxed">
                    <a href="tel:+13126033070" className="hover:text-[#0C1B33] transition-colors print-url">(312) 603-3070</a>
                  </p>
                  <a
                    href="https://www.cookcountyil.gov/service/economic-development"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0C1B33]/35 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide mt-1 print-url"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    cookcountyil.gov
                  </a>
                </div>
                <div>
                  <p className="text-[#0C1B33]/70 text-[13px] font-semibold mb-1">State of Illinois</p>
                  <p className="text-[#0C1B33]/40 text-[12px] leading-relaxed mb-1.5">
                    Dept. of Commerce &amp; Economic Opportunity
                  </p>
                  <p className="text-[#0C1B33]/40 text-[11px] leading-relaxed">
                    <a href="tel:+12178146732" className="hover:text-[#0C1B33] transition-colors print-url">(217) 814-6732</a>
                  </p>
                  <a
                    href="https://dceo.illinois.gov"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0C1B33]/35 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide mt-1 print-url"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    dceo.illinois.gov
                  </a>
                </div>
              </div>
            </div>}

            {/* ── Footer ── */}
            {showPersonaView ? (
              <PersonaReportFooter report={report} />
            ) : (
            <div className="report-footer mt-8 pt-6 border-t border-dashed border-[#0C1B33]/15">
              <p className="text-[#0C1B33]/35 text-[12px] leading-relaxed mb-2">
                This report was generated on {formattedDate} by Chicago
                Incentive Explorer.
              </p>
              <p className="text-[#0C1B33]/25 text-[11px] leading-relaxed">
                Program details, funding rounds, and eligibility rules change over
                time. This is an informational tool &mdash; confirm eligibility
                with program administrators.
              </p>
            </div>
            )}
          </div>
        </div>

        {/* Persona switching remains a live control after the gate (PR #210),
            but sits outside the report paper so the paper itself keeps the
            closed R5 board inventory. */}
        {showPersonaLens && showPersonaView && !compact && (
          <div className="mx-auto mt-4 max-w-[850px] overflow-hidden bg-white shadow-sm print:hidden">
            <PersonaChips
              persona={persona}
              onSelect={handlePersonaSelect}
              report={report}
            />
            {isFramedPersonaLink && persona !== DEFAULT_PERSONA && (
              <div
                data-testid="framed-persona-notice"
                className="flex items-center gap-2 border-t border-[#0C1B33]/8 bg-[#EFF3FB] px-5 py-2.5 text-[11px] text-[#0C1B33]/70 sm:px-12 md:px-16"
              >
                <span>
                  Viewing as <strong className="font-semibold">{personaLabel(persona)}</strong> — the
                  lens this link was shared with.
                </span>
                <button
                  type="button"
                  onClick={() => handlePersonaSelect(DEFAULT_PERSONA)}
                  className="cursor-pointer font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#2563EB] hover:underline"
                >
                  Switch to All for everything
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Action Buttons (outside the document) ── */}
        <div className={`report-actions mx-auto max-w-[850px] print:hidden mt-8 ${compact ? "hidden" : ""}`}>
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-3">
            <button
              onClick={handlePrint}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#0C1B33]/80 transition-colors cursor-pointer shadow-md"
            >
              <Printer className="w-3.5 h-3.5" />
              Download PDF
            </button>
            <button
              onClick={handleSaveReport}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-md"
            >
              <FileText className="w-3.5 h-3.5" />
              {isVacancyReport ? "Save Report" : "Save to Workspace"}
            </button>
            <StartPreparationPacketButton
              report={report}
              wizardState={reportWizardState}
              source={`${analyticsSource}_report_actions`}
              className="w-full sm:w-auto px-8 py-3.5 shadow-md"
            />
            <button
              onClick={handleEmailReportClick}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#2563EB]/30 text-[#2563EB] font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#2563EB]/5 hover:border-[#2563EB]/50 transition-colors cursor-pointer shadow-md"
            >
              <Mail className="w-3.5 h-3.5" />
              {isVacancyReport ? "Email This to Me" : "Email Report"}
            </button>
            {vacancySpreadsheetLocale && (
              <button
                onClick={handleVacancySpreadsheetExport}
                disabled={isExportingVacancySpreadsheet}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer shadow-md"
              >
                {isExportingVacancySpreadsheet ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                Vacancy Spreadsheet
              </button>
            )}
            {reportWizardState && !isDrawnAreaReport && (
              <button
                onClick={handleShareReport}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
              >
                {linkCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Link Copied!
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5" />
                    Share Report
                  </>
                )}
              </button>
            )}
            {/* The Brief (spec v2 item 5): a one-page, forwardable summary
                — only offered on a real persona lens (it reads the lensed
                programs/contacts the same way Contact Sheet does). */}
            {showPersonaLens && persona !== DEFAULT_PERSONA && reportWizardState && (
              <button
                onClick={() => setBriefState((prev) => ({ ...prev, askOpen: true }))}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
              >
                <FileText className="w-3.5 h-3.5" />
                Build My Brief
              </button>
            )}
            {!compact && onCompare && !compareMode && (
              <button
                onClick={onCompare}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
              >
                <MapPin className="w-3.5 h-3.5" />
                Compare Another Address
              </button>
            )}
            {/* Refine intentionally lives only in the top value panel — it
                previously competed with 8 same-weight buttons here (audit
                RF5). PR #49's refine_clicked keeps firing from the panel
                with location "banner"; "action_row" retires with the button. */}
            <button
              onClick={onStartOver}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {isInstantMode ? "New Search" : "Start Over"}
            </button>
          </div>

          {/* Compare address input */}
          {compareMode && !compareGeoResult && (
            <div className="mt-5 mx-auto max-w-md">
              <label className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-2">
                Enter a second address to compare
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={compareAddressInput || ""}
                  onChange={(e) => setCompareAddressInput?.(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onCompareGeocode?.(); }}
                  placeholder="e.g. 200 N LaSalle St, Chicago"
                  className="flex-1 px-4 py-3 bg-white border border-[#0C1B33]/15 text-[13px] text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#0C1B33]/30 font-mono-bureau"
                />
                <button
                  onClick={onCompareGeocode}
                  disabled={compareGeocoding || !compareAddressInput?.trim()}
                  className="px-5 py-3 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:bg-[#0C1B33]/80 transition-colors disabled:opacity-30 cursor-pointer"
                >
                  {compareGeocoding ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Compare loading state */}
          {compareMode && compareGeoResult && !compareGeoResult && (
            <div className="mt-5 text-center">
              <div className="flex gap-1.5 justify-center mb-2">
                <div className="w-1.5 h-1.5 bg-[#0C1B33]/20 rounded-full animate-pulse" />
                <div className="w-1.5 h-1.5 bg-[#0C1B33]/20 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
                <div className="w-1.5 h-1.5 bg-[#0C1B33]/20 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
              </div>
              <p className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/30">
                Generating comparison report...
              </p>
            </div>
          )}
        </div>
      </div>
      {/* Download Lead Capture */}
      {downloadGateOpen && (
        <DownloadGateModal
          reportAddress={report.metadata?.address}
          reportTitle={report.title}
          onDownload={handleDownloadAfterCapture}
          onClose={() => setDownloadGateOpen(false)}
          allowSkip
        />
      )}
      {/* Email Report Dialog */}
      {emailDialogOpen && (
        <EmailReportModal
          report={report}
          onClose={() => setEmailDialogOpen(false)}
          onSent={() => trackEvent("report_emailed", reportAnalyticsPayload(report, "report_email_modal"))}
        />
      )}
      {saveModalOpen && (
        <SaveReportModal
          reportData={report}
          wizardState={reportWizardState}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
      {/* The Brief (spec v2 item 5): the two-question ask, then the
          one-page shareable itself. Both read the SAME lensed report — no
          second generation path. */}
      {briefState.askOpen && (
        <BriefStageAsk
          onComplete={handleBriefComplete}
          onCancel={() => setBriefState((prev) => ({ ...prev, askOpen: false }))}
        />
      )}
      {briefState.open && briefState.stage && briefState.priority && (
        <div id="brief-overlay" className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4">
          <div className="mx-auto flex max-w-[860px] flex-col gap-3 py-6">
            <div className="flex items-center justify-between gap-3 print:hidden">
              <span className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-white">
                The Brief
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBriefPrint}
                  className="inline-flex items-center gap-2 bg-[#2563EB] px-4 py-2.5 font-mono-bureau text-[9.5px] tracking-[0.1em] uppercase text-white"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print (2-up)
                </button>
                <button
                  type="button"
                  onClick={() => setBriefState((prev) => ({ ...prev, open: false }))}
                  className="inline-flex items-center gap-2 border border-white/30 px-4 py-2.5 font-mono-bureau text-[9.5px] tracking-[0.1em] uppercase text-white"
                >
                  Close
                </button>
              </div>
            </div>
            <div id="brief-print-2up" className="grid grid-cols-1 gap-4 print:grid-cols-2 print:gap-[0.3in]">
              <BriefPage
                report={lensed}
                persona={persona}
                stage={briefState.stage}
                priority={briefState.priority}
                reportUrl={briefReportUrl}
              />
              {/* Second copy — screen-hidden, print-only. Two-up print CSS
                  (spec v2 item 5): the same brief twice on one landscape
                  sheet, for handing to two people or filing + carrying. */}
              <div className="hidden print:block">
                <BriefPage
                  report={lensed}
                  persona={persona}
                  stage={briefState.stage}
                  priority={briefState.priority}
                  reportUrl={briefReportUrl}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
