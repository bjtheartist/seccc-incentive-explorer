"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Search,
  MapPin,
  FileText,
  Loader2,
  RotateCcw,
  Printer,
  ExternalLink,
  Mail,
  Link2,
} from "lucide-react";
import { encodeWizardState } from "@/lib/url-state";
import { generateReportPdf } from "@/lib/pdf-report";
import { selectedProjectGoalLabels } from "@/lib/report-wizard-config";
import type { WizardState } from "@/lib/report-wizard-config";
import {
  normalizePublicReportForDisplay,
  SECTION_IDS,
  type GeneratedReport,
  type ReportSection,
  type ReportItem,
} from "@/lib/report-engine";
import ReportZoningMap from "@/components/report/ReportZoningMap";
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
  buildIncentiveAnalysisUrl,
  buildTableCsv,
  buildVacancySpreadsheetCsv,
  downloadCsv,
  programContextToText,
  slugifyFilePart,
  zoneMatchesToText,
  type VacancySpreadsheetFeature,
} from "@/lib/vacancy-spreadsheet";
import { filterAreaVacancyFeatures } from "@/lib/area-vacancy-presentation";
import {
  assessDrawnAreaRecordDriftComparability,
  compareDrawnAreaRecordManifest,
  hasCompleteCurrentDrawnAreaSelection,
  resolveVacancySpreadsheetScope,
  safeVacancyProgramUrl,
} from "@/lib/vacancy-spreadsheet-scope";
import {
  parseDrawnAreaVacancyResponse,
  type VacancyCoverageMetadata,
} from "@/lib/drawn-area-vacancy";
import {
  AnchorCards,
  ComparisonBar,
  EconomicSignalCards,
  visibleSectionItems,
} from "@/components/report/NeighborhoodEconomics";
import { ZoningReviewQuestions } from "@/components/zoning/ZoningReviewQuestions";
import { ZoningStarterHandoff } from "@/components/zoning/ZoningStarterHandoff";
import {
  PreparationCostBadge,
  parseDocumentCostLine,
} from "@/components/report/PreparationCostBadge";
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
import { GroupedReportDetail } from "@/components/report/GroupedReportDetail";
import { CapitalPartnerHandoff } from "@/components/report/CapitalPartnerHandoff";
import { CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE } from "@/lib/capital-partner-report";
import { isSupportOrganizationSectionTitle } from "@/lib/support-organization-copy";
import { StartPreparationPacketButton } from "@/components/incentive-preparation/StartPreparationPacketButton";
import { SaveReportModal } from "@/components/workspace/SaveReportModal";
import { storePendingReport } from "@/components/workspace/PendingReportSaver";
import { WatchAreaButton } from "@/components/workspace/WatchAreaButton";
import { trackEvent } from "@/lib/analytics-events";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

/**
 * Match a section by its stable id, falling back to the English title only
 * for sections saved before the `id` field existed. Renaming a section's
 * title in report-engine.ts must never change what this finds.
 */
function sectionMatchesIdOrTitle(section: ReportSection, id: string, title: string): boolean {
  return section.id ? section.id === id : section.title === title;
}

const fadeIn = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: "easeOut" as const },
};

// ─── Report Display ──────────────────────────────────────────────────

// Small analytics helpers, intentionally duplicated from app/report/page.tsx.
// This component and app/report/page.tsx's local ReportDisplay are two
// diverged forks of the same UI (see RF2/RO1); unifying them is out of
// scope here, so instrumentation added to one is mirrored in the other by
// hand instead of shared.
function analyticsReportKey(report: GeneratedReport): string {
  return [
    report.reportType,
    report.generatedAt,
    report.metadata?.address || report.title,
  ].join("|");
}

function reportAnalyticsPayload(
  report: GeneratedReport,
  source: string,
  metadata: Record<string, string | number | boolean | null | (string | number | boolean)[]> = {}
) {
  return {
    reportType: report.reportType,
    source,
    address: report.metadata?.address ?? null,
    lat: report.metadata?.lat ?? null,
    lon: report.metadata?.lon ?? null,
    metadata: {
      reportKey: analyticsReportKey(report),
      reportTitle: report.title,
      ...metadata,
    },
  };
}

export function ReportDisplay({
  report: rawReport,
  onStartOver,
  onRefine,
  isInstantMode,
  showPersonaLens,
  wizardState: reportWizardState,
  compact,
  onCompare,
  compareMode,
  compareAddressInput,
  setCompareAddressInput,
  compareGeocoding,
  onCompareGeocode,
  compareGeoResult,
  analyticsSource = "workspace",
}: {
  report: GeneratedReport;
  onStartOver: () => void;
  onRefine?: () => void;
  isInstantMode?: boolean;
  /**
   * Persona lens visibility (Tier 1b, BM4). Deliberately decoupled from
   * isInstantMode (which is snapshot-only — false on saved goal-refined
   * reports): persona (audience) and goal (project outcome) are orthogonal
   * lenses, so callers pass this for any location-anchored site report.
   */
  showPersonaLens?: boolean;
  wizardState?: WizardState;
  compact?: boolean;
  onCompare?: () => void;
  compareMode?: boolean;
  compareAddressInput?: string;
  setCompareAddressInput?: (v: string) => void;
  compareGeocoding?: boolean;
  onCompareGeocode?: () => void;
  compareGeoResult?: { lat: number; lon: number; display_name: string } | null;
  // review7 S20 (MEDIUM): `programs?: Program[]` removed — see
  // ReportNavigationLinks.tsx's own comment on why it was already dead
  // (no real caller ever populated it; `programReportItem()` already
  // sets every field the `programById` lookup below used to fall back
  // to, confirmed during review6 S11).
  /** Entry-point label used on refine/save/email instrumentation (Tier 0 audit). */
  analyticsSource?: string;
}) {
  const report = useMemo(() => normalizePublicReportForDisplay(rawReport), [rawReport]);
  const { status } = useSession();
  const [linkCopied, setLinkCopied] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [isExportingVacancySpreadsheet, setIsExportingVacancySpreadsheet] =
    useState(false);
  const [isLoadingVacancySpreadsheet, setIsLoadingVacancySpreadsheet] =
    useState(false);
  const [vacancySpreadsheetFeatures, setVacancySpreadsheetFeatures] =
    useState<VacancySpreadsheetFeature[] | null>(null);
  const vacancySpreadsheetCoverageRef =
    useRef<VacancyCoverageMetadata | null>(null);
  const [vacancySpreadsheetError, setVacancySpreadsheetError] =
    useState<string | null>(null);
  const [editedSummaryText, setEditedSummaryText] = useState(
    report.executiveSummary?.whyTheseMatter || ""
  );
  const supportSection = useMemo(
    () => report.sections?.find((section) => isSupportOrganizationSectionTitle(section.title)) ?? null,
    [report.sections],
  );
  const supportItems = useMemo(
    () => supportSection?.items.slice(1) ?? [],
    [supportSection],
  );
  const viewedSupportKeyRef = useRef<string | null>(null);

  // ── Persona lens (Tier 1b, audit BM4) ──
  // A viewing lens over this snapshot: re-orders and collapses existing content
  // client-side. Canonical `report` stays untouched (save/email/PDF/refine use
  // it); only the on-screen sections + roadmap read the lensed copy.
  const [persona, setPersona] = useState<PersonaId>(DEFAULT_PERSONA);
  useEffect(() => {
    // Resolve after mount to avoid a hydration mismatch; a forwarded ?persona=
    // (or the per-session choice) opens the snapshot in that lens.
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
  // Shared-link recipient experience (spec v2 deliverable 7) — see the live
  // fork (app/report/page.tsx) for the full rationale on why this is a
  // render-time derivation rather than its own useState slot.
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
  // below — see the live fork (app/report/page.tsx) for the full rationale.
  let guidepostBandTracker: GuidepostPart | null = boardPersona === "looking" ? 1 : null;

  // ── TOC ──
  // Gate finding 19: id-first (see app/report/page.tsx's fuller rationale)
  // — a title-only anchor would have silently changed the rendered anchor
  // id out from under every TOC link/deep-link the moment gate finding
  // 19's per-persona title overrides landed.
  const sectionToAnchor = (section: ReportSection) =>
    isSupportOrganizationSectionTitle(section.title)
      ? "your-support-network"
      : section.id ?? section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /** Stable identity for a section's UI state — see the live fork
   *  (app/report/page.tsx) for the full rationale (adversarial review
   *  finding #9: index-keyed state desyncs when the persona lens reorders
   *  `lensed.sections`). Identical to sectionToAnchor since gate finding
   *  19 (both are id-first); kept as a separate name for readability. */
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

  // Guidepost band (spec v2 visual law) — see the live fork
  // (app/report/page.tsx) for the full rationale.
  const renderGuidepostBand = (part: GuidepostPart) => (
    <PersonaGuidepostBand key={`guidepost-part-${part}`} part={part} />
  );

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

  const [downloadGateOpen, setDownloadGateOpen] = useState(false);
  // The Brief (gate finding 8 — workspace-fork parity, spec v2 item 5): one
  // state slot for the two-question ask + open/closed, matching
  // app/report/page.tsx's own briefState exactly (no ordinal-useState
  // harness constrains this file — only app/report/page.tsx's private
  // inline ReportDisplay function is seeded by REPORT_DISPLAY_STATE_ORDER
  // in report-page-live-renderer.test.tsx; this exported component has no
  // such harness).
  const [briefState, setBriefState] = useState<BriefUiState>(DEFAULT_BRIEF_UI_STATE);
  // sm_ params (additive, spec v2 item 5): a link carrying sm_stage/
  // sm_priority opens straight into the brief, skipping the ask — mirrors
  // app/report/page.tsx's own effect exactly.
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
      setTimeout(() => setLinkCopied(false), 2500);
    });
  }, [persona, reportWizardState]);

  // The Brief (gate finding 8). The backlink reuses the exact same
  // share-URL construction as handleShareReport (round-trips the persona
  // lens); `src=brief` attributes a reader arriving at the full report
  // from a forwarded Brief. Matches app/report/page.tsx's briefReportUrl.
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

  useEffect(() => {
    if (!supportSection || supportItems.length === 0) return;
    const supportViewKey = `${analyticsReportKey(report)}|support-view|${analyticsSource}`;
    if (viewedSupportKeyRef.current === supportViewKey) return;
    viewedSupportKeyRef.current = supportViewKey;

    trackEvent(
      "support_resource_viewed",
      reportAnalyticsPayload(report, "report_support_network", {
        organizationCount: supportItems.length,
        organizationNames: supportItems.map((item) => item.label),
        originSource: analyticsSource,
      }),
    );
  }, [analyticsSource, report, supportItems, supportSection]);

  const trackSupportResourceClick = useCallback(
    (item: ReportItem) => {
      trackEvent(
        "support_resource_clicked",
        reportAnalyticsPayload(report, "report_support_network", {
          organizationName: item.label,
          organizationType: item.value || "local_support",
          contactMethod: "website",
          originSource: analyticsSource,
        }),
      );
    },
    [analyticsSource, report],
  );

  const trackSectionLinkClick = useCallback(
    (section: ReportSection, item: ReportItem) => {
      if (section.title !== CAPITAL_PARTNER_SECTION_TITLE) return;
      trackEvent(
        "capital_partner_clicked",
        reportAnalyticsPayload(report, "report_capital_partner_section", {
          partnerId: item.partnerId || item.label,
          partnerName: item.label,
          contactMethod: "website",
          originSource: analyticsSource,
        }),
      );
    },
    [analyticsSource, report],
  );

  // Refine exposure event (Tier 0 / BM6), and a click handler that records
  // banner-vs-action-row location (RF5) — mirrors app/report/page.tsx's
  // in-file ReportDisplay so refine instrumentation isn't dark on saved
  // Workspace reports too (RF1's success metric depends on this).
  const refineShownKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isInstantMode || !onRefine || compact) return;
    const shownKey = `${analyticsReportKey(report)}|refine-shown|${analyticsSource}`;
    if (refineShownKeyRef.current === shownKey) return;
    refineShownKeyRef.current = shownKey;

    trackEvent(
      "refine_cta_shown",
      reportAnalyticsPayload(report, analyticsSource, { isInstantMode })
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
  const vacancySpreadsheetScope = useMemo(
    () => resolveVacancySpreadsheetScope(report, reportWizardState),
    [report, reportWizardState],
  );
  const isDrawnAreaReport =
    (vacancySpreadsheetScope.status === "ready" &&
      vacancySpreadsheetScope.kind === "drawn-area") ||
    vacancySpreadsheetScope.status === "unavailable";
  const vacancySpreadsheetLocale =
    vacancySpreadsheetScope.status === "ready"
      ? vacancySpreadsheetScope.label
      : "";
  const vacancySpreadsheetDisplayName =
    vacancySpreadsheetScope.status === "ready" &&
    vacancySpreadsheetScope.kind === "drawn-area"
      ? report.title.trim() || vacancySpreadsheetScope.label
      : vacancySpreadsheetLocale;
  const vacancySpreadsheetRequestPath =
    vacancySpreadsheetScope.status === "ready"
      ? vacancySpreadsheetScope.requestPath
      : "";

  const vacancyFeaturesForScope = useCallback(
    (features: VacancySpreadsheetFeature[]): VacancySpreadsheetFeature[] => {
      if (
        vacancySpreadsheetScope.status !== "ready" ||
        vacancySpreadsheetScope.kind !== "drawn-area"
      ) {
        return features;
      }
      const filters = vacancySpreadsheetScope.drawnArea.provenance.vacancy.filters;
      return filterAreaVacancyFeatures(
        features as GeoJSON.Feature[],
        filters.freshness,
        filters.license,
      ) as VacancySpreadsheetFeature[];
    },
    [vacancySpreadsheetScope],
  );
  const vacancyPayloadForScope = useCallback(
    (value: unknown): {
      features: VacancySpreadsheetFeature[];
      coverage: VacancyCoverageMetadata | null;
    } => {
      if (
        vacancySpreadsheetScope.status === "ready" &&
        vacancySpreadsheetScope.kind === "drawn-area"
      ) {
        const parsed = parseDrawnAreaVacancyResponse(value);
        if (!parsed) throw new Error("Malformed drawn-area vacancy response");
        return {
          features: vacancyFeaturesForScope(parsed.features),
          coverage: parsed.meta,
        };
      }
      const collection = value as { features?: VacancySpreadsheetFeature[] };
      return {
        features: vacancyFeaturesForScope(collection.features ?? []),
        coverage: null,
      };
    },
    [vacancyFeaturesForScope, vacancySpreadsheetScope],
  );

  useEffect(() => {
    if (compact || !vacancySpreadsheetRequestPath) {
      setVacancySpreadsheetFeatures(null);
      vacancySpreadsheetCoverageRef.current = null;
      setVacancySpreadsheetError(null);
      setIsLoadingVacancySpreadsheet(false);
      return;
    }

    const controller = new AbortController();
    setVacancySpreadsheetFeatures(null);
    vacancySpreadsheetCoverageRef.current = null;

    async function loadVacancySpreadsheet() {
      setIsLoadingVacancySpreadsheet(true);
      setVacancySpreadsheetError(null);
      try {
        const res = await fetch(vacancySpreadsheetRequestPath, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Vacancy spreadsheet unavailable");

        const data: unknown = await res.json();
        const payload = vacancyPayloadForScope(data);
        vacancySpreadsheetCoverageRef.current = payload.coverage;
        setVacancySpreadsheetFeatures(payload.features);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[report] vacancy spreadsheet load failed:", err);
        setVacancySpreadsheetFeatures(null);
        vacancySpreadsheetCoverageRef.current = null;
        setVacancySpreadsheetError("Vacancy spreadsheet could not be loaded.");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingVacancySpreadsheet(false);
        }
      }
    }

    loadVacancySpreadsheet();

    return () => controller.abort();
  }, [compact, vacancyPayloadForScope, vacancySpreadsheetRequestPath]);

  const handleVacancySpreadsheetExport = useCallback(async () => {
    if (!vacancySpreadsheetRequestPath) return;

    setIsExportingVacancySpreadsheet(true);
    try {
      let features = vacancySpreadsheetFeatures;
      if (!features) {
        const res = await fetch(vacancySpreadsheetRequestPath);
        if (!res.ok) throw new Error("Vacancy export failed");

        const data: unknown = await res.json();
        const payload = vacancyPayloadForScope(data);
        features = payload.features;
        vacancySpreadsheetCoverageRef.current = payload.coverage;
        setVacancySpreadsheetFeatures(features);
      }
      if (
        vacancySpreadsheetScope.status === "ready" &&
        vacancySpreadsheetScope.kind === "drawn-area" &&
        !hasCompleteCurrentDrawnAreaSelection(
          vacancySpreadsheetScope.drawnArea,
          vacancySpreadsheetCoverageRef.current,
        )
      ) {
        throw new Error(
          "Incomplete drawn-area vacancy selection cannot be exported as a complete spreadsheet",
        );
      }

      const csvProvenance =
        vacancySpreadsheetScope.status === "ready" &&
        vacancySpreadsheetScope.kind === "drawn-area"
          ? {
              scopeFingerprint:
                vacancySpreadsheetScope.drawnArea.scope.fingerprint,
              selectionMethod: "point_in_saved_polygon",
              scopeGeneratedAt: vacancySpreadsheetScope.drawnArea.generatedAt,
              generationFreshnessFilter:
                vacancySpreadsheetScope.drawnArea.provenance.vacancy.filters
                  .freshness,
              generationLicenseFilter:
                vacancySpreadsheetScope.drawnArea.provenance.vacancy.filters
                  .license,
              generationManifestSelectedCount:
                vacancySpreadsheetScope.drawnArea.provenance.vacancy
                  .selectedCount,
              generationCoverageStatus:
                vacancySpreadsheetScope.drawnArea.provenance.vacancy.coverage
                  ?.status,
              generationLicenseScreeningStatus:
                vacancySpreadsheetScope.drawnArea.provenance.vacancy.coverage
                  ?.licenseScreeningStatus,
              generationSourcePath:
                vacancySpreadsheetScope.drawnArea.provenance.vacancy.source
                  ?.path,
              generationFallbackReason:
                vacancySpreadsheetScope.drawnArea.provenance.vacancy.coverage
                  ?.fallbackReason,
              generationCclbaSourceCoverage:
                vacancySpreadsheetScope.drawnArea.provenance.vacancy.coverage
                  ?.cclbaSourceCoverage,
              currentCoverageStatus:
                vacancySpreadsheetCoverageRef.current?.coverageStatus,
              currentLicenseScreeningStatus:
                vacancySpreadsheetCoverageRef.current?.licenseScreening.status,
              currentSourcePath:
                vacancySpreadsheetCoverageRef.current?.sourcePath,
              currentFallbackReason:
                vacancySpreadsheetCoverageRef.current?.fallbackReason,
              currentCclbaSourceCoverage:
                vacancySpreadsheetCoverageRef.current?.cclbaSourceCoverage,
            }
          : {
              selectionMethod: "community_area_boundary",
              currentCclbaSourceCoverage:
                vacancySpreadsheetCoverageRef.current?.cclbaSourceCoverage,
            };
      downloadCsv(
        buildVacancySpreadsheetCsv(features, csvProvenance),
        `vacant-properties-${slugifyFilePart(vacancySpreadsheetDisplayName)}-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (err) {
      console.error("[report] vacancy spreadsheet export failed:", err);
    } finally {
      setIsExportingVacancySpreadsheet(false);
    }
  }, [
    vacancyPayloadForScope,
    vacancySpreadsheetFeatures,
    vacancySpreadsheetDisplayName,
    vacancySpreadsheetRequestPath,
    vacancySpreadsheetScope,
  ]);

  const vacancySpreadsheetStats = useMemo(() => {
    const features = vacancySpreadsheetFeatures ?? [];
    return {
      total: features.length,
      land: features.filter((feature) => feature.properties?.propertyType === "vacant_land").length,
      buildings: features.filter((feature) => feature.properties?.propertyType === "vacant_building").length,
      publicOwnership: features.filter((feature) => feature.properties?.ownerType === "city_public").length,
    };
  }, [vacancySpreadsheetFeatures]);
  const drawnAreaRecordDrift = useMemo(() => {
    if (
      vacancySpreadsheetScope.status !== "ready" ||
      vacancySpreadsheetScope.kind !== "drawn-area" ||
      !vacancySpreadsheetFeatures
    ) {
      return null;
    }
    const comparability = assessDrawnAreaRecordDriftComparability(
      vacancySpreadsheetScope.drawnArea,
      vacancySpreadsheetCoverageRef.current,
    );
    if (comparability.status !== "comparable") return null;
    return compareDrawnAreaRecordManifest(
      vacancySpreadsheetScope.drawnArea,
      vacancySpreadsheetFeatures,
    );
  }, [vacancySpreadsheetFeatures, vacancySpreadsheetScope]);
  const drawnAreaRecordDriftComparability = useMemo(() => {
    if (
      vacancySpreadsheetScope.status !== "ready" ||
      vacancySpreadsheetScope.kind !== "drawn-area" ||
      !vacancySpreadsheetFeatures
    ) {
      return null;
    }
    return assessDrawnAreaRecordDriftComparability(
      vacancySpreadsheetScope.drawnArea,
      vacancySpreadsheetCoverageRef.current,
    );
  }, [vacancySpreadsheetFeatures, vacancySpreadsheetScope]);
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
    const features = vacancySpreadsheetFeatures ?? [];
    const isDrawnArea =
      vacancySpreadsheetScope.status === "ready" &&
      vacancySpreadsheetScope.kind === "drawn-area";
    const responsePending =
      isLoadingVacancySpreadsheet ||
      (vacancySpreadsheetFeatures === null && !vacancySpreadsheetError);
    const currentLicenseConflictScreeningIncomplete =
      isDrawnArea &&
      vacancySpreadsheetScope.drawnArea.provenance.vacancy.filters.license ===
        "conflicts" &&
      vacancySpreadsheetCoverageRef.current?.licenseScreening.status !==
        "available";
    const currentSelectionIncomplete =
      isDrawnArea &&
      !hasCompleteCurrentDrawnAreaSelection(
        vacancySpreadsheetScope.drawnArea,
        vacancySpreadsheetCoverageRef.current,
      );
    const canExportVacancySpreadsheet =
      !isDrawnArea ||
      (vacancySpreadsheetFeatures !== null &&
        !vacancySpreadsheetError &&
        !currentSelectionIncomplete);
    const spreadsheetCount = (count: number, loadingLabel: string): string => {
      if (responsePending) return loadingLabel;
      if (vacancySpreadsheetError) return "Unavailable";
      if (currentSelectionIncomplete) {
        return count > 0 ? `${count.toLocaleString("en-US")}+` : "Incomplete";
      }
      return count.toLocaleString("en-US");
    };

    return (
      <motion.div {...fadeIn}>
        <div className="min-h-screen bg-[#F5F5F0] py-4 sm:py-8 px-2 sm:px-6 print:bg-white">
          <div className="mx-auto max-w-[1180px] bg-white shadow-xl print:shadow-none">
            <div className="bg-[#0C1B33] px-5 sm:px-12 md:px-16 pt-12 pb-10">
              <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/40 mb-5">
                Chicago Site Incentive Map
              </p>
              <h1 className="font-editorial text-3xl sm:text-4xl lg:text-[42px] text-white leading-tight mb-3">
                Vacancy Spreadsheet — {vacancySpreadsheetDisplayName}
              </h1>
              <p className="text-white/50 text-[15px] leading-relaxed max-w-xl mb-6">
                {isDrawnArea
                  ? "Tracked vacancy-record addresses and site context inside the exact boundary saved with this report."
                  : "Tracked vacancy-record addresses and site context for the selected Chicago community area."}
              </p>
              <div className="w-10 h-[3px] bg-white/30" />
            </div>

            <div className="px-5 sm:px-12 md:px-16 py-5 border-b border-[#0C1B33]/8 flex flex-wrap gap-x-8 gap-y-3">
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
                  Output
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  Vacancy Record Spreadsheet
                </span>
              </div>
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  {isDrawnArea ? "Saved area" : "Locale"}
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {vacancySpreadsheetDisplayName}
                </span>
              </div>
            </div>

            <div className="px-5 sm:px-12 md:px-16 py-10">
              {isDrawnArea && vacancySpreadsheetScope.status === "ready" && (
                <div className="border border-[#2563EB]/15 bg-[#EFF6FF] px-4 py-4 mb-8">
                  <p className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#2563EB] mb-2">
                    Provenance chain
                  </p>
                  <p className="text-[12px] leading-relaxed text-[#0C1B33]/65">
                    Exact saved polygon · fingerprint {vacancySpreadsheetScope.drawnArea.scope.fingerprint} · saved {vacancySpreadsheetScope.drawnArea.generatedAt} · current results filtered under the saved evidence policy.
                  </p>
                  {drawnAreaRecordDrift && (
                    <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/50">
                      Generation manifest: {drawnAreaRecordDrift.saved.toLocaleString("en-US")} records. Current polygon result: {drawnAreaRecordDrift.current.toLocaleString("en-US")} ({drawnAreaRecordDrift.added.toLocaleString("en-US")} added, {drawnAreaRecordDrift.removed.toLocaleString("en-US")} removed, {drawnAreaRecordDrift.changedSnapshots.toLocaleString("en-US")} source snapshot changed since save, {drawnAreaRecordDrift.snapshotsNotComparable.toLocaleString("en-US")} shared-record snapshot comparison unavailable).
                    </p>
                  )}
                  {!responsePending &&
                    !drawnAreaRecordDrift &&
                    drawnAreaRecordDriftComparability?.status === "unavailable" && (
                      <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/50">
                        {drawnAreaRecordDriftComparability.detail}
                      </p>
                    )}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#0C1B33]/8 mb-8">
                {[
                  ["Records", spreadsheetCount(vacancySpreadsheetStats.total, "Loading")],
                  ["Vacant land", spreadsheetCount(vacancySpreadsheetStats.land, "...")],
                  ["Buildings", spreadsheetCount(vacancySpreadsheetStats.buildings, "...")],
                  ["Public ownership", spreadsheetCount(vacancySpreadsheetStats.publicOwnership, "...")],
                ].map(([label, value]) => (
                  <div key={label} className="bg-[#FAF9F6] px-4 py-4">
                    <span className="font-mono-bureau text-[8px] tracking-[0.18em] uppercase text-[#0C1B33]/25 block mb-1">
                      {label}
                    </span>
                    <span className="font-mono-bureau text-[17px] text-[#0C1B33]/75">
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
                <div>
                  <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33] mb-2">
                    Tracked Vacancy Addresses
                  </h2>
                  <p className="text-[#0C1B33]/40 text-[13px] leading-relaxed max-w-2xl">
                    Download the CSV to share, filter, or continue analysis in a spreadsheet tool.
                  </p>
                </div>
                <button
                  onClick={handleVacancySpreadsheetExport}
                  disabled={isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet || !canExportVacancySpreadsheet}
                  className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-6 py-3 hover:bg-[#0C1B33]/80 disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer"
                >
                  {isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
                  Download CSV
                </button>
              </div>

              {vacancySpreadsheetError && (
                <div className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 mb-5">
                  {vacancySpreadsheetError}
                </div>
              )}

              <div className="border border-[#0C1B33]/8 overflow-x-auto">
                <table className="w-full min-w-[1140px] text-left text-[12px]">
                  <thead className="bg-[#0C1B33]/[0.03]">
                    <tr>
                      {[
                        "Address",
                        "Type",
                        "Ward",
                        "Community Area",
                        "Zoning",
                        "Sq Ft",
                        "Owner",
                        "Owner Type",
                        "Source status / context",
                        "Zones",
                        "Source",
                        "Action",
                      ].map((heading) => (
                        <th
                          key={heading}
                          className="px-3 py-3 font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/35"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#0C1B33]/5">
                    {responsePending ? (
                      <tr>
                        <td colSpan={12} className="px-3 py-8 text-center text-[#0C1B33]/35">
                          Loading vacancy records...
                        </td>
                      </tr>
                    ) : vacancySpreadsheetError ? (
                      <tr>
                        <td colSpan={12} className="px-3 py-8 text-center text-[#0C1B33]/35">
                          Vacancy records are unavailable. No zero-record claim is being made.
                        </td>
                      </tr>
                    ) : features.length > 0 ? (
                      features.map((feature, rowIndex) => {
                        const property = feature.properties ?? {};
                        const programName =
                          typeof property.programName === "string" && property.programName.trim()
                            ? property.programName.trim()
                            : null;
                        const managingOrganization =
                          typeof property.managingOrganization === "string" && property.managingOrganization.trim()
                            ? property.managingOrganization.trim()
                            : null;
                        const applicationUrl = safeVacancyProgramUrl(property.applicationUrl);
                        const sourceContext = programContextToText(property.programContext);
                        const sourceStatus =
                          typeof property.status === "string" && property.status.trim()
                            ? property.status.trim()
                            : null;
                        return (
                          <tr key={`${property.address ?? "property"}-${rowIndex}`} className="hover:bg-[#FAF9F6]">
                            <td className="px-3 py-3 text-[#0C1B33]/75 font-medium">
                              {String(property.address ?? "Unknown address")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/50">
                              {property.propertyType === "vacant_land" ? "Land" : property.propertyType === "vacant_building" ? "Building" : String(property.propertyType ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {String(property.ward ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {String(property.communityArea ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {String(property.zoningClass ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {Number(property.squareFeet ?? 0).toLocaleString()}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45 max-w-[220px] truncate">
                              {String(property.ownerName ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45">
                              {String(property.ownerType ?? "")}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45 max-w-[240px]">
                              {sourceStatus || programName || managingOrganization || sourceContext || applicationUrl ? (
                                <div className="space-y-1">
                                  {sourceStatus && (
                                    <div>Source status: {sourceStatus}</div>
                                  )}
                                  {programName && <div>{programName}</div>}
                                  {managingOrganization && (
                                    <div className="text-[#0C1B33]/35">
                                      Managed by {managingOrganization}
                                    </div>
                                  )}
                                  {sourceContext && (
                                    <div className="text-[#0C1B33]/35 break-words">
                                      {sourceContext}
                                    </div>
                                  )}
                                  {(programName || managingOrganization || sourceContext || applicationUrl) && (
                                    <div className="text-[#0C1B33]/35">
                                      Published context; verify current availability and terms.
                                    </div>
                                  )}
                                  {applicationUrl && (
                                    <a
                                      href={applicationUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[#2563EB] hover:underline"
                                    >
                                      Review published program record
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45 max-w-[260px] truncate">
                              {zoneMatchesToText(property.zoneMatches)}
                            </td>
                            <td className="px-3 py-3 text-[#0C1B33]/45 max-w-[220px]">
                              {typeof property.sourceUrl === "string" && property.sourceUrl ? (
                                <a
                                  href={property.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[#2563EB] hover:underline"
                                >
                                  {String(property.sourceDatasetLabel ?? property.source ?? "Source record")}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                String(property.sourceDatasetLabel ?? property.source ?? "")
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <a
                                href={buildIncentiveAnalysisUrl(feature)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 whitespace-nowrap border border-[#2563EB]/25 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB] transition-colors hover:bg-[#2563EB]/5 hover:border-[#2563EB]/45"
                              >
                                <ArrowRight className="w-3 h-3" />
                                Run Analysis
                              </a>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={12} className="px-3 py-8 text-center text-[#0C1B33]/35">
                          {currentLicenseConflictScreeningIncomplete
                            ? "No conflict rows were returned, but current license screening is incomplete and cannot establish a clean zero."
                            : currentSelectionIncomplete
                              ? "No rows were returned, but current coverage is incomplete and cannot establish a clean zero."
                            : `No tracked vacancy records returned for this ${isDrawnArea ? "saved area" : "locale"}.`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-[1180px] print:hidden mt-8">
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-3">
              <button
                onClick={handleVacancySpreadsheetExport}
                disabled={isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet || !canExportVacancySpreadsheet}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#0C1B33]/80 disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer shadow-md"
              >
                {isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
                Download CSV
              </button>
              <button
                onClick={handleSaveReport}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-md"
              >
                <FileText className="w-3.5 h-3.5" />
                Save Report
              </button>
              <StartPreparationPacketButton
                report={report}
                wizardState={reportWizardState}
                source={`${analyticsSource}_vacancy_actions`}
                className="w-full sm:w-auto px-8 py-3.5 shadow-md"
              />
              <button
                onClick={handleEmailReportClick}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#2563EB]/30 text-[#2563EB] font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#2563EB]/5 hover:border-[#2563EB]/50 transition-colors cursor-pointer shadow-md"
              >
                <Mail className="w-3.5 h-3.5" />
                Email This to Me
              </button>
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
                      Share Spreadsheet
                    </>
                  )}
                </button>
              )}
              {!compact && onCompare && !compareMode && (
                <button
                  onClick={onCompare}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Compare Neighborhoods
                </button>
              )}
              <button
                onClick={onStartOver}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                New Search
              </button>
            </div>

            {compareMode && !compareGeoResult && (
              <div className="mt-5 mx-auto max-w-md">
                <label className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-2">
                  Enter a neighborhood or address to compare
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
          </div>
        </div>
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
      </motion.div>
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

          {vacancySpreadsheetScope.status === "unavailable" && (
            <div className="mx-5 sm:mx-12 md:mx-16 mt-6 border border-amber-300/60 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-[#0C1B33]/70">
              {vacancySpreadsheetScope.reason === "malformed-scope"
                ? "This drawn-area report contains an invalid saved boundary or provenance contract. The stored summary is shown below, but no boundary re-query or CSV can be recreated safely. Redraw the area to create a new exact-scope report."
                : "This legacy drawn-area report did not save its boundary. The stored report is shown below, but a full boundary CSV cannot be recreated honestly. Redraw the area to create a new exact-scope report."}
            </div>
          )}

          {/* Refine value preview (audit RF6/WU5/BM1): honestly sell what
              refining unlocks instead of the old undersell disclaimer.
              Rendered in compact (compare) mode too — audit RF4. The refine
              path routes through handleRefineClick so PR #49's refine_clicked
              keeps firing (location: banner) alongside the panel's own
              refine_value_preview_shown exposure event. */}
          {isInstantMode && !showPersonaView && (
            <RefineValuePanel
              report={report}
              context={compact ? "compare_a" : "workspace"}
              onRefine={onRefine ? () => handleRefineClick("banner") : undefined}
              compact={compact}
            />
          )}

          {/* ── Persona lens chips (Tier 1b, BM4). Gated on showPersonaLens,
              NOT isInstantMode (snapshot-only), so saved goal-refined reports
              keep the lens too. ── */}
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

          {!showPersonaView && (
            <CapitalPartnerHandoff
              report={report}
              source={analyticsSource}
              compact={compact}
            />
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
                <ActionRoadmapSection items={lensed.actionRoadmap} />
              </div>
            )}

            {/* ── Content Sections ── */}
            {(() => {
              let personaSectionCounter = boardPersona === "looking" ? 1 : 0;
              const personaAlsoSection = lensed.sections?.find(
                (section) => section.collapsedByPersona,
              );
              return lensed.sections?.flatMap((section, sectionIdx) => {
                // Part-03 correction (late owner amendment, binding): on a
                // real persona lens, Part 03 contains EXACTLY ONE section —
                // the Contact Sheet. Suppress the raw support-organizations
                // section here; its orgs still reach the reader, lane-ranked
                // and why-lined, as ContactSheet rows below. "All" is
                // untouched.
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
                const guidepostPart = showPersonaView
                  ? guidepostPartForSection(section, persona)
                  : null;
                const isPersonaProgramSection =
                  showPersonaView && section.guidepostBucket === "programs";
                const isPersonaFactSection =
                  showPersonaView &&
                  ["siteFacts", "logisticsAccess", "civicRepresentation", "zoning"].includes(
                    section.guidepostBucket ?? "",
                  );
                const band =
                  guidepostPart !== null && guidepostPart !== guidepostBandTracker
                    ? renderGuidepostBand(guidepostPart)
                    : null;
                guidepostBandTracker = guidepostPart;
                // Persona lens: the "Also at this address" group collapses (never
                // hides) into a native disclosure. Print/PDF is generated from the
                // canonical report, so this only affects the on-screen view.
                const Wrapper = !showPersonaView && section.collapsedByPersona ? "details" : "div";
                const handleSectionToggle = !showPersonaView && section.collapsedByPersona
                  ? (event: React.SyntheticEvent<HTMLDetailsElement>) => {
                      trackEvent("section_expanded", {
                        reportType: report.reportType,
                        source: "report_section_toggle",
                        metadata: {
                          sectionId: sectionToAnchor(section),
                          sectionTitle: section.title,
                          sectionIndex: sectionIdx,
                          state: event.currentTarget.open ? "expanded" : "collapsed",
                        },
                      });
                    }
                  : undefined;

                const sectionElement = (
                  <Wrapper
                    key={sectionStateKey(section)}
                    id={sectionToAnchor(section)}
                    data-persona-section-open={showPersonaView ? "true" : undefined}
                    className={`report-section ${showPersonaView ? "mb-0 border-b border-[#D8DDE6] py-4" : "mb-14"} ${!showPersonaView && section.collapsedByPersona ? "persona-collapsed border border-[#0C1B33]/8 px-5 py-4" : ""}`}
                    {...(handleSectionToggle
                      ? // The dynamic Wrapper type ("details" | "div") makes JSX validate
                        // onToggle against both element prop types; it only ever renders
                        // on the "details" branch, where the handler's element type is
                        // exact.
                        ({ onToggle: handleSectionToggle } as unknown as Record<string, unknown>)
                      : {})}
                  >
                    {!showPersonaView && section.collapsedByPersona && (
                      <summary className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#2563EB] cursor-pointer select-none">
                        {section.title} · {section.items.length} more
                      </summary>
                    )}
                    <div className={`flex items-baseline mb-4 ${showPersonaView ? "gap-2.5" : "gap-4"}`}>
                      <span className={showPersonaView ? "font-mono-bureau text-[10px] text-[#2563EB]" : "font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8"}>
                        {sectionNumber}
                      </span>
                      <h2 className={showPersonaView ? "font-editorial text-[15.5px] font-semibold normal-case tracking-normal text-[#0C1B33]" : "font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]"}>
                        {section.title}
                      </h2>
                    </div>
                    {!showPersonaView && <hr className="border-[#0C1B33]/8 mb-5" />}
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
                          // review7 S20 (MEDIUM): the itemProgram/programById
                          // fallback removed — see ReportNavigationLinks.tsx's
                          // own comment; programReportItem() already sets
                          // these fields directly on every program-linked
                          // ReportItem, so the fallback was already dead
                          // (confirmed during review6 S11's investigation).
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
                                      onClick={() => trackSupportResourceClick(reportItem)}
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
                    {showPersonaView &&
                      section.guidepostBucket === "programs" &&
                      personaAlsoSection && (
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
                  </Wrapper>
                );
                const supplements =
                  isPersonaProgramSection && boardPersona
                    ? (
                        <PersonaProgramSupplements
                          key={`${sectionStateKey(section)}-supplements`}
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

        {/* Persona switching remains available without becoming an extra
            section inside the closed R5 report paper. */}
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
            {report.metadata?.lat != null && report.metadata?.lon != null && (
              <WatchAreaButton
                lat={report.metadata.lat}
                lon={report.metadata.lon}
                label={report.metadata?.address || report.title}
                callbackUrl={`/map?lat=${report.metadata.lat}&lon=${report.metadata.lon}&label=${encodeURIComponent(report.metadata?.address || report.title)}`}
                variant="action"
              />
            )}
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
            {/* The Brief (gate finding 8, spec v2 item 5): a one-page,
                forwardable summary — only offered on a real persona lens.
                Matches app/report/page.tsx's own button exactly. */}
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
      {/* The Brief (gate finding 8, spec v2 item 5): the two-question ask,
          then the one-page shareable itself. Both read the SAME lensed
          report — no second generation path. Matches app/report/page.tsx's
          own block exactly — the workspace/saved-report fork previously
          had NO Brief at all, a documented gap now closed. */}
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
