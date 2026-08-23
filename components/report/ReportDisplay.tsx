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
  slugifyFilePart,
  zoneMatchesToText,
  type VacancySpreadsheetFeature,
} from "@/lib/vacancy-spreadsheet";
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
import { ProgramsMatchedHere } from "@/components/report/ProgramsMatchedHere";
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

/** Fixed 3-part guidepost anatomy (spec v2 visual law) — same order always;
 *  personas change what fills each part, never the parts themselves. */
const GUIDEPOST_PART_LABELS: Record<GuidepostPart, string> = {
  1: "Site & Standing",
  2: "Capital & Programs",
  3: "Partners & Next Steps",
};

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
  // Tracks the last guidepost PART band emitted by the section-render loop
  // below — see the live fork (app/report/page.tsx) for the full rationale.
  let guidepostBandTracker: GuidepostPart | null = null;

  // ── TOC ──
  const sectionToAnchor = (title: string) =>
    isSupportOrganizationSectionTitle(title)
      ? "your-support-network"
      : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /** Stable identity for a section's UI state — see the live fork
   *  (app/report/page.tsx) for the full rationale (adversarial review
   *  finding #9: index-keyed state desyncs when the persona lens reorders
   *  `lensed.sections`). */
  const sectionStateKey = (section: ReportSection) => section.id ?? sectionToAnchor(section.title);

  // Guidepost band (spec v2 visual law) — see the live fork
  // (app/report/page.tsx) for the full rationale.
  const renderGuidepostBand = (part: GuidepostPart) => (
    <div key={`guidepost-part-${part}`} className="mt-10 mb-6 flex items-center gap-3 print:hidden">
      <span className="font-mono-bureau text-[10px] tracking-[0.18em] uppercase text-white bg-[#0C1B33] px-2.5 py-1">
        {`PART ${String(part).padStart(2, "0")}`}
      </span>
      <span className="font-editorial text-xl sm:text-2xl text-[#0C1B33]">{GUIDEPOST_PART_LABELS[part]}</span>
      <span className="h-[2px] flex-grow bg-[#0C1B33]" />
    </div>
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
        entries.push({ label: s.title, anchor: sectionToAnchor(s.title) });
      }
    }
    if (lensed.recommendedActions && lensed.recommendedActions.length > 0) entries.push({ label: "Recommended Actions", anchor: "recommended-actions" });
    if (lensed.dataSources && lensed.dataSources.length > 0) entries.push({ label: "Data Sources", anchor: "data-sources" });
    return entries;
  }, [lensed]);

  const [downloadGateOpen, setDownloadGateOpen] = useState(false);

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
  const vacancySpreadsheetLocale =
    isVacancyReport && reportWizardState?.neighborhood
      ? reportWizardState.neighborhood.trim()
      : "";

  useEffect(() => {
    if (!vacancySpreadsheetLocale) {
      setVacancySpreadsheetFeatures(null);
      setVacancySpreadsheetError(null);
      setIsLoadingVacancySpreadsheet(false);
      return;
    }

    const controller = new AbortController();

    async function loadVacancySpreadsheet() {
      setIsLoadingVacancySpreadsheet(true);
      setVacancySpreadsheetError(null);
      try {
        const res = await fetch(
          `/api/vacant?communityArea=${encodeURIComponent(vacancySpreadsheetLocale)}&limit=10000`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("Vacancy spreadsheet unavailable");

        const data = (await res.json()) as {
          features?: VacancySpreadsheetFeature[];
        };
        setVacancySpreadsheetFeatures(data.features ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[report] vacancy spreadsheet load failed:", err);
        setVacancySpreadsheetFeatures(null);
        setVacancySpreadsheetError("Vacancy spreadsheet could not be loaded.");
      } finally {
        setIsLoadingVacancySpreadsheet(false);
      }
    }

    loadVacancySpreadsheet();

    return () => controller.abort();
  }, [vacancySpreadsheetLocale]);

  const handleVacancySpreadsheetExport = useCallback(async () => {
    if (!vacancySpreadsheetLocale) return;

    setIsExportingVacancySpreadsheet(true);
    try {
      let features = vacancySpreadsheetFeatures;
      if (!features) {
        const res = await fetch(
          `/api/vacant?communityArea=${encodeURIComponent(vacancySpreadsheetLocale)}&limit=10000`
        );
        if (!res.ok) throw new Error("Vacancy export failed");

        const data = (await res.json()) as {
          features?: VacancySpreadsheetFeature[];
        };
        features = data.features ?? [];
        setVacancySpreadsheetFeatures(features);
      }

      downloadCsv(
        buildVacancySpreadsheetCsv(features),
        `vacant-properties-${slugifyFilePart(vacancySpreadsheetLocale)}-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (err) {
      console.error("[report] vacancy spreadsheet export failed:", err);
    } finally {
      setIsExportingVacancySpreadsheet(false);
    }
  }, [vacancySpreadsheetFeatures, vacancySpreadsheetLocale]);

  const vacancySpreadsheetStats = useMemo(() => {
    const features = vacancySpreadsheetFeatures ?? [];
    return {
      total: features.length,
      land: features.filter((feature) => feature.properties?.propertyType === "vacant_land").length,
      buildings: features.filter((feature) => feature.properties?.propertyType === "vacant_building").length,
      cityOwned: features.filter((feature) => feature.properties?.ownerType === "city_public").length,
    };
  }, [vacancySpreadsheetFeatures]);
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

    return (
      <motion.div {...fadeIn}>
        <div className="min-h-screen bg-[#F5F5F0] py-4 sm:py-8 px-2 sm:px-6 print:bg-white">
          <div className="mx-auto max-w-[1180px] bg-white shadow-xl print:shadow-none">
            <div className="bg-[#0C1B33] px-5 sm:px-12 md:px-16 pt-12 pb-10">
              <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/40 mb-5">
                Chicago Site Incentive Map
              </p>
              <h1 className="font-editorial text-3xl sm:text-4xl lg:text-[42px] text-white leading-tight mb-3">
                Vacancy Spreadsheet — {vacancySpreadsheetLocale}
              </h1>
              <p className="text-white/50 text-[15px] leading-relaxed max-w-xl mb-6">
                Vacant-property addresses and site context for the selected Chicago community area.
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
                  Vacant Property Spreadsheet
                </span>
              </div>
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Locale
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {vacancySpreadsheetLocale}
                </span>
              </div>
            </div>

            <div className="px-5 sm:px-12 md:px-16 py-10">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#0C1B33]/8 mb-8">
                {[
                  ["Properties", isLoadingVacancySpreadsheet ? "Loading" : vacancySpreadsheetStats.total.toLocaleString()],
                  ["Vacant land", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.land.toLocaleString()],
                  ["Buildings", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.buildings.toLocaleString()],
                  ["City / public", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.cityOwned.toLocaleString()],
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
                    Vacant Property Addresses
                  </h2>
                  <p className="text-[#0C1B33]/40 text-[13px] leading-relaxed max-w-2xl">
                    Download the CSV to share, filter, or continue analysis in a spreadsheet tool.
                  </p>
                </div>
                <button
                  onClick={handleVacancySpreadsheetExport}
                  disabled={isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet}
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
                <table className="w-full min-w-[980px] text-left text-[12px]">
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
                        "Zones",
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
                    {isLoadingVacancySpreadsheet ? (
                      <tr>
                        <td colSpan={10} className="px-3 py-8 text-center text-[#0C1B33]/35">
                          Loading vacant properties...
                        </td>
                      </tr>
                    ) : features.length > 0 ? (
                      features.map((feature, rowIndex) => {
                        const property = feature.properties ?? {};
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
                            <td className="px-3 py-3 text-[#0C1B33]/45 max-w-[260px] truncate">
                              {zoneMatchesToText(property.zoneMatches)}
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
                        <td colSpan={10} className="px-3 py-8 text-center text-[#0C1B33]/35">
                          No vacant properties found for this locale.
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
                disabled={isLoadingVacancySpreadsheet || isExportingVacancySpreadsheet}
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
              {reportWizardState && (
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

          {/* Refine value preview (audit RF6/WU5/BM1): honestly sell what
              refining unlocks instead of the old undersell disclaimer.
              Rendered in compact (compare) mode too — audit RF4. The refine
              path routes through handleRefineClick so PR #49's refine_clicked
              keeps firing (location: banner) alongside the panel's own
              refine_value_preview_shown exposure event. */}
          {isInstantMode && (
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
          {showPersonaLens && !compact && (
            <PersonaChips
              persona={persona}
              onSelect={handlePersonaSelect}
              report={report}
            />
          )}

          {/* Shared-link recipient experience (spec v2 deliverable 7): a
              framed link opened in the sender's chosen lens — say so, and
              offer the one-tap escape to the unfiltered view. */}
          {showPersonaLens && !compact && isFramedPersonaLink && persona !== DEFAULT_PERSONA && (
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

          <CapitalPartnerHandoff
            report={report}
            source={analyticsSource}
            compact={compact}
          />

          {/* ── Table of Contents ── */}
          {tocEntries.length > 0 && (
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
          {report.metadata?.lat != null && report.metadata?.lon != null && (
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
            {/* ── Start Here (Phase B of the startHere consolidation): the
                canonical one-action card, first content block in the body.
                Absent on reports without report.startHere (older saved
                reports, or report types outside the executive-summary
                gate) — the rest of the body renders unchanged either way. ── */}
            <StartHereCard report={report} source={analyticsSource} />

            {/* ── Overview text ── */}
            {report.summary && (
              <div className="mb-12">
                <p className="text-[#0C1B33]/60 text-[15px] leading-[1.8] max-w-prose">
                  {report.summary}
                </p>
              </div>
            )}

            {vacancySpreadsheetLocale && (
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
                    ["City / public", isLoadingVacancySpreadsheet ? "..." : vacancySpreadsheetStats.cityOwned.toLocaleString()],
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
            {report.verdict && (
              <div id="verdict">
                <VerdictCard verdict={report.verdict} />
                {showPersonaLens && (
                  <ProgramsMatchedHere
                    report={lensed}
                    persona={persona}
                    programsAnchor={sectionToAnchor(
                      lensed.sections?.find(
                        (s) => !s.collapsedByPersona && s.items?.some((item) => item.programId),
                      )?.title ?? "",
                    )}
                  />
                )}
              </div>
            )}

            {/* ── Executive Summary from Confidence Engine ── */}
            {report.executiveSummary && (
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
            {lensed.actionRoadmap && lensed.actionRoadmap.length > 0 && (
              <div id="action-roadmap">
                <ActionRoadmapSection items={lensed.actionRoadmap} />
              </div>
            )}

            {/* ── Content Sections ── */}
            {(() => {
              return lensed.sections?.flatMap((section, sectionIdx) => {
                // Part-03 correction (late owner amendment, binding): on a
                // real persona lens, Part 03 contains EXACTLY ONE section —
                // the Contact Sheet. Suppress the raw support-organizations
                // section here; its orgs still reach the reader, lane-ranked
                // and why-lined, as ContactSheet rows below. "All" is
                // untouched.
                if (
                  isSupportOrganizationSectionTitle(section.title) &&
                  showPersonaLens &&
                  persona !== DEFAULT_PERSONA
                ) {
                  return [];
                }

                const sectionNumber = String(sectionIdx + sectionOffset + 1).padStart(2, "0");
                const guidepostPart = guidepostPartForSection(section, persona);
                const band =
                  guidepostPart !== null && guidepostPart !== guidepostBandTracker
                    ? renderGuidepostBand(guidepostPart)
                    : null;
                guidepostBandTracker = guidepostPart;
                // Persona lens: the "Also at this address" group collapses (never
                // hides) into a native disclosure. Print/PDF is generated from the
                // canonical report, so this only affects the on-screen view.
                const Wrapper = section.collapsedByPersona ? "details" : "div";
                const handleSectionToggle = section.collapsedByPersona
                  ? (event: React.SyntheticEvent<HTMLDetailsElement>) => {
                      trackEvent("section_expanded", {
                        reportType: report.reportType,
                        source: "report_section_toggle",
                        metadata: {
                          sectionId: sectionToAnchor(section.title),
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
                    id={sectionToAnchor(section.title)}
                    className={`report-section mb-14 ${section.collapsedByPersona ? "persona-collapsed border border-[#0C1B33]/8 px-5 py-4" : ""}`}
                    {...(handleSectionToggle
                      ? // The dynamic Wrapper type ("details" | "div") makes JSX validate
                        // onToggle against both element prop types; it only ever renders
                        // on the "details" branch, where the handler's element type is
                        // exact.
                        ({ onToggle: handleSectionToggle } as unknown as Record<string, unknown>)
                      : {})}
                  >
                    {section.collapsedByPersona && (
                      <summary className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#2563EB] cursor-pointer select-none">
                        {section.title} · {section.items.length} more
                      </summary>
                    )}
                    <div className="flex items-baseline gap-4 mb-4">
                      <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                        {sectionNumber}
                      </span>
                      <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                        {section.title}
                      </h2>
                    </div>
                    <hr className="border-[#0C1B33]/8 mb-5" />
	                    {section.description && (
	                      <p className="text-[#0C1B33]/35 text-[13px] leading-relaxed mb-6 max-w-prose">
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
                      <div className="space-y-0 divide-y divide-[#0C1B33]/5">
                        {visibleSectionItems(section).map((item, itemIdx) => {
                          const reportItem = item as ReportNavigationItem;
                          const isSupportNetworkItem = isSupportOrganizationSectionTitle(section.title);
                          const isDeadlineItem = sectionMatchesIdOrTitle(section, SECTION_IDS.upcomingDeadlines, "Upcoming Deadlines Near This Address");
                          const supportWebsiteUrl = isSupportNetworkItem ? (reportItem.sourceUrl || reportItem.url) : undefined;
                          const hasGroupedDetail = Boolean(item.detailGroups?.length);
                          const hasSideValue = Boolean(item.value && !hasGroupedDetail);
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
                              className="report-item py-5 first:pt-0 sm:py-6"
                            >
                            <div className={`grid grid-cols-1 gap-3 ${hasSideValue ? "sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-x-10" : ""}`}>
                              {/* Left: label */}
                              <div className="flex-1 min-w-0">
                                <span className="flex flex-wrap items-center gap-2 text-[#0C1B33] text-[13px] sm:text-[14px] font-semibold">
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
                                {!hasGroupedDetail && item.detail && sectionMatchesIdOrTitle(section, SECTION_IDS.requiredDocuments, "Required Documents") ? (
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
                                ) : !hasGroupedDetail && item.detail ? (
                                  <span className={`mt-1.5 block text-[12px] leading-[1.65] text-[#0C1B33]/50 sm:text-[13px] ${isSupportNetworkItem || isDeadlineItem || sectionMatchesIdOrTitle(section, CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE) ? "whitespace-pre-line" : ""}`}>
                                    {item.detail}
                                  </span>
                                ) : null}
                              </div>

                              {/* Right: value */}
                              {hasSideValue && (
                                <span className="min-w-0 break-words font-mono-bureau text-[11px] leading-[1.7] text-[#0C1B33]/50 sm:text-[12px]">
                                  {item.value}
                                </span>
                              )}
                            </div>

                            {hasGroupedDetail && item.detailGroups && (
                              <GroupedReportDetail
                                summary={item.value}
                                groups={item.detailGroups}
                                caveat={item.detailCaveat}
                              />
                            )}

                            {/* Public program evidence and official navigation */}
                            {!isSupportNetworkItem && (item.matchExplanation || item.eligibilityRules || item.url || hasNavigationLinks) && (
                              <Accordion type="single" collapsible className="mt-3 sm:mt-4">
                                <AccordionItem value="program-review" className="border-none">
                                  <AccordionTrigger className="py-2 hover:no-underline font-mono-bureau text-[9px] tracking-[0.1em] text-[#0C1B33]/40 uppercase">
                                    Program review details
                                  </AccordionTrigger>
                                  <AccordionContent className="report-eligibility pl-4 border-l border-[#0C1B33]/8 space-y-2">
                                    <MatchExplanationDetails explanation={item.matchExplanation} />
                                    {/* review6 S11 investigation: the raw `item.whoQualifies`
                                        block that used to render here (labeled "Published
                                        Applicant Requirements") was removed — it displayed
                                        unfiltered internal catalog prose verbatim, the exact
                                        field PublicProgramView deliberately excludes and for
                                        the same reason. `item.eligibilityRules` below covers
                                        the same underlying fact through the reviewed,
                                        structured form. */}
                                    {item.eligibilityRules && item.eligibilityRules.length > 0 && (
                                      <div>
                                        <span className="font-mono-bureau text-[8px] tracking-[0.2em] uppercase text-[#0C1B33]/25 block mb-1">
                                          Requirements
                                        </span>
                                        <ul className="space-y-0.5">
                                          {item.eligibilityRules.map((rule, rIdx) => (
                                            <li key={rIdx} className="flex items-start gap-2 text-[11px] text-[#0C1B33]/40 leading-relaxed">
                                              <span className="text-[#0C1B33]/20 mt-0.5 flex-shrink-0">{rule.required ? "Required:" : "Optional:"}</span>
                                              <span>{rule.description}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
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
                return band ? [band, sectionElement] : sectionElement;
              });
            })()}

            {/* Contact Sheet (spec v2 deliverable 8, Part-03 correction):
                Part 03's ONE section on a real persona lens — the raw
                support-organizations section was suppressed above; its
                orgs surface here instead, lane-ranked and why-lined.
                "All" is untouched (no ContactSheet, no guidepost at all). */}
            {showPersonaLens && persona !== DEFAULT_PERSONA && (
              <>
                {guidepostBandTracker !== 3 && renderGuidepostBand(3)}
                <div className="mt-8">
                  <ContactSheet report={lensed} persona={persona} />
                </div>
              </>
            )}

            {/* ── Recommended Actions ──
                Demoted behind native disclosure when report.startHere is
                present — StartHereCard already surfaced the one dominant
                action at the top of the body, so this list (still every
                action, unchanged content) collapses instead of competing
                with it. Absent report.startHere, this renders exactly as
                before. */}
            {report.recommendedActions &&
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
            {report.dataSources && report.dataSources.length > 0 && (
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
            <div className="mt-16 pt-8 border-t border-[#0C1B33]/8">
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
            </div>

            {/* ── Footer ── */}
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
          </div>
        </div>

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
            {reportWizardState && (
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
    </motion.div>
  );
}

