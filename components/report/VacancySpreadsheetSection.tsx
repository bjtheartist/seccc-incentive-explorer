"use client";

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
import type { WizardState } from "@/lib/report-wizard-config";
import type { GeneratedReport, ReportSection } from "@/lib/report-engine";
import {
  DownloadGateModal,
  EmailReportModal,
} from "@/components/report/ReportModals";
import { SaveReportModal } from "@/components/workspace/SaveReportModal";
import { StartPreparationPacketButton } from "@/components/incentive-preparation/StartPreparationPacketButton";
import {
  buildIncentiveAnalysisUrl,
  programContextToText,
  zoneMatchesToText,
} from "@/lib/vacancy-spreadsheet";
import {
  hasCompleteCurrentDrawnAreaSelection,
  safeVacancyProgramUrl,
  type VacancySpreadsheetScope,
} from "@/lib/vacancy-spreadsheet-scope";
import {
  activeAreaPermitFilterLabels,
  activeAreaVacancyFilterLabels,
} from "@/lib/area-analysis-workstation";
import { formatPermitAreaCoverageLabel } from "@/lib/permit-area";
import { trackEvent } from "@/lib/analytics-events";
import type { VacancySpreadsheetSectionData } from "@/components/report/useVacancySpreadsheetSection";

/**
 * The drawn-area / vacancy-spreadsheet report surface, shared by both
 * report forks (app/report/page.tsx's local `ReportDisplay` and the
 * exported components/report/ReportDisplay.tsx). Moved here verbatim from
 * components/report/ReportDisplay.tsx — the fuller of the two forks as of
 * this extraction, which already carried the "area analysis workstation"
 * (the saved-area, read-only evidence-family view) that
 * app/report/page.tsx's fork never gained.
 *
 * Doctrine: SHARED COMPONENTS ONLY across the two forks for drawn-area
 * rendering (persona spec v2, binding). See lib/source-guard/fork-parity.ts
 * for the guard that keeps this true, and docs/persona-report-parity.md
 * for the parity-by-construction ruling on the workstation specifically.
 *
 * This component owns no state of its own beyond render-scoped `const`s —
 * every stateful/effectful concern lives in the paired
 * `useVacancySpreadsheetSection` hook (both forks call it once and pass its
 * return value down as the `vacancy` prop), and every other cross-cutting
 * concern (save/share/email/print, compare mode) is threaded through as
 * props from whichever fork's top-level `ReportDisplay` function owns that
 * state — this component never re-declares it.
 */

const fadeIn = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: "easeOut" as const },
};

function SavedAreaEvidenceSection({
  section,
  eyebrow,
}: {
  section: ReportSection;
  eyebrow: string;
}) {
  return (
    <div className="border border-[#0C1B33]/10 bg-white">
      <div className="border-b border-[#0C1B33]/8 px-5 py-5 sm:px-6">
        <p className="mb-2 font-mono-bureau text-[8px] uppercase tracking-[0.22em] text-[#2563EB]">
          {eyebrow}
        </p>
        <h3 className="font-editorial text-2xl leading-tight text-[#0C1B33]">
          {section.title}
        </h3>
        {section.description && (
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[#0C1B33]/50">
            {section.description}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-px bg-[#0C1B33]/8 sm:grid-cols-2">
        {section.items.map((item, index) => (
          <div
            key={`${item.label}-${index}`}
            className="min-w-0 bg-[#FAF9F6] px-5 py-4 sm:px-6"
          >
            <dt className="font-mono-bureau text-[8px] uppercase tracking-[0.18em] text-[#0C1B33]/35">
              {item.label}
            </dt>
            <dd className="mt-1 break-words text-[15px] font-medium text-[#0C1B33]/80">
              {item.value}
            </dd>
            {item.detail && (
              <p className="mt-2 break-words text-[12px] leading-relaxed text-[#0C1B33]/50">
                {item.detail}
              </p>
            )}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB] hover:underline"
              >
                Review source
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * A drawn-area report whose saved boundary is missing or malformed cannot
 * safely re-query or export a CSV. Rendered unconditionally by both forks
 * (it no-ops for any other scope status) so this small amber notice can
 * never drift out of sync between them the way the rest of this surface
 * once did.
 */
export function DrawnAreaScopeUnavailableBanner({
  scope,
}: {
  scope: VacancySpreadsheetScope;
}) {
  if (scope.status !== "unavailable") return null;
  return (
    <div className="mx-5 sm:mx-12 md:mx-16 mt-6 border border-amber-300/60 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-[#0C1B33]/70">
      {scope.reason === "malformed-scope"
        ? "This drawn-area report contains an invalid saved boundary or provenance contract. The stored summary is shown below, but no boundary re-query or CSV can be recreated safely. Redraw the area to create a new exact-scope report."
        : "This legacy drawn-area report did not save its boundary. The stored report is shown below, but a full boundary CSV cannot be recreated honestly. Redraw the area to create a new exact-scope report."}
    </div>
  );
}

// Small analytics helper, intentionally duplicated from each fork's own
// top-level ReportDisplay (same precedent as those forks' own copies of
// this — see components/report/ReportDisplay.tsx's header comment).
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

export interface VacancySpreadsheetSectionProps {
  report: GeneratedReport;
  reportWizardState?: WizardState;
  compact?: boolean;
  analyticsSource: string;
  formattedDate: string;
  onStartOver: () => void;
  onCompare?: () => void;
  compareMode?: boolean;
  compareAddressInput?: string;
  setCompareAddressInput?: (v: string) => void;
  compareGeocoding?: boolean;
  onCompareGeocode?: () => void;
  compareGeoResult?: { lat: number; lon: number; display_name: string } | null;
  handleShareReport: () => void;
  handleSaveReport: () => void;
  handlePrint: () => void;
  /** R1 finding 5: awaited by DownloadGateModal, so failures are real. */
  handleDownloadAfterCapture: () => Promise<void>;
  handleEmailReportClick: () => void;
  linkCopied: boolean;
  downloadGateOpen: boolean;
  setDownloadGateOpen: (v: boolean) => void;
  emailDialogOpen: boolean;
  setEmailDialogOpen: (v: boolean) => void;
  saveModalOpen: boolean;
  setSaveModalOpen: (v: boolean) => void;
  /** Return value of the paired useVacancySpreadsheetSection hook. */
  vacancy: VacancySpreadsheetSectionData;
}

/**
 * Renders when `vacancy.vacancySpreadsheetLocale && !compact` — callers
 * check that condition themselves (it's their own early-return branch) and
 * mount this component only then; see either fork's `ReportDisplay` for
 * the call site.
 */
export function VacancySpreadsheetSection({
  report,
  reportWizardState,
  compact,
  analyticsSource,
  formattedDate,
  onStartOver,
  onCompare,
  compareMode,
  compareAddressInput,
  setCompareAddressInput,
  compareGeocoding,
  onCompareGeocode,
  compareGeoResult,
  handleShareReport,
  handleSaveReport,
  handlePrint,
  handleDownloadAfterCapture,
  handleEmailReportClick,
  linkCopied,
  downloadGateOpen,
  setDownloadGateOpen,
  emailDialogOpen,
  setEmailDialogOpen,
  saveModalOpen,
  setSaveModalOpen,
  vacancy,
}: VacancySpreadsheetSectionProps) {
  const {
    vacancySpreadsheetScope,
    isDrawnAreaReport,
    vacancySpreadsheetDisplayName,
    vacancySpreadsheetFeatures,
    vacancySpreadsheetError,
    currentVacancyCoverage,
    isLoadingVacancySpreadsheet,
    isExportingVacancySpreadsheet,
    handleVacancySpreadsheetExport,
    vacancySpreadsheetStats,
    drawnAreaRecordDrift,
    drawnAreaRecordDriftComparability,
    savedAreaPermitAnalysis,
    savedAreaPermitError,
    isLoadingSavedAreaPermit,
    savedAreaVisibleVacancyCount,
    setSavedAreaVisibleVacancyCount,
  } = vacancy;

  const features = vacancySpreadsheetFeatures ?? [];
  const isDrawnArea =
    vacancySpreadsheetScope.status === "ready" &&
    vacancySpreadsheetScope.kind === "drawn-area";
  const responsePending =
    isLoadingVacancySpreadsheet ||
    (vacancySpreadsheetFeatures === null && !vacancySpreadsheetError);
  const permitResponsePending =
    isDrawnArea &&
    (isLoadingSavedAreaPermit ||
      (savedAreaPermitAnalysis === null && savedAreaPermitError === null));
  const currentLicenseConflictScreeningIncomplete =
    isDrawnArea &&
    vacancySpreadsheetScope.drawnArea.provenance.vacancy.filters.license ===
      "conflicts" &&
    currentVacancyCoverage?.licenseScreening.status !==
      "available";
  const currentSelectionIncomplete =
    isDrawnArea &&
    !hasCompleteCurrentDrawnAreaSelection(
      vacancySpreadsheetScope.drawnArea,
      currentVacancyCoverage,
    );
  const canExportVacancySpreadsheet =
    !isDrawnArea ||
    (vacancySpreadsheetFeatures !== null &&
      !vacancySpreadsheetError &&
      !currentSelectionIncomplete &&
      !permitResponsePending);
  const currentVacancyReturnedCount = isDrawnArea
    ? currentVacancyCoverage?.returnedCount ?? null
    : null;
  const vacancyEmptyStateMessage = currentLicenseConflictScreeningIncomplete
    ? "No conflict rows were returned, but current license screening is incomplete and cannot establish a clean zero."
    : currentSelectionIncomplete
      ? "No rows were returned, but current coverage is incomplete and cannot establish a clean zero."
      : isDrawnArea &&
          currentVacancyReturnedCount !== null &&
          currentVacancyReturnedCount > 0
        ? `No vacancy signals match the saved filters. The current source refresh returned ${currentVacancyReturnedCount.toLocaleString("en-US")} record${currentVacancyReturnedCount === 1 ? "" : "s"} inside this area before the saved evidence and workstation filters.`
        : `No tracked vacancy records returned for this ${isDrawnArea ? "saved area" : "locale"}.`;
  const spreadsheetCount = (count: number, loadingLabel: string): string => {
    if (responsePending) return loadingLabel;
    if (vacancySpreadsheetError) return "Unavailable";
    if (currentSelectionIncomplete) {
      return count > 0 ? `${count.toLocaleString("en-US")}+` : "Incomplete";
    }
    return count.toLocaleString("en-US");
  };

  if (isDrawnArea && vacancySpreadsheetScope.status === "ready") {
    const areaSnapshotSection = report.sections.find(
      (section) => section.title === "Area Snapshot",
    );
    const vacancySections = report.sections.filter(
      (section) => section.title === "Priority Properties",
    );
    const contextSections = report.sections.filter((section) =>
      ["Incentive Zones in Area", "Ownership Breakdown"].includes(
        section.title,
      ),
    );
    const permitSections = report.sections.filter((section) =>
      [
        "Permit Filing Context",
        "Recent Permit Records in Current View",
      ].includes(section.title),
    );
    const provenanceSections = report.sections.filter(
      (section) => section.title === "Provenance Chain",
    );
    const recognizedSectionTitles = new Set([
      "Area Snapshot",
      "Priority Properties",
      "Incentive Zones in Area",
      "Ownership Breakdown",
      "Permit Filing Context",
      "Recent Permit Records in Current View",
      "Practitioner Notes",
      "Provenance Chain",
    ]);
    const additionalSections = report.sections.filter(
      (section) => !recognizedSectionTitles.has(section.title),
    );
    const permitProvenance =
      vacancySpreadsheetScope.drawnArea.provenance.permit;
    const showPermitEvidence =
      permitSections.length > 0 || permitProvenance.status !== "not_attached";
    // The stored scope name remains the exact area label for CSV/provenance.
    // A workspace rename, however, is the authoritative document heading.
    // Strip only the generated title prefix so an untouched report still
    // reads "Area Analysis — <label>" without contaminating export rows.
    const savedAreaName = (
      report.title.trim() || vacancySpreadsheetDisplayName
    ).replace(/^Area Analysis Report\s*[—-]\s*/i, "");
    const visibleFeatures = features.slice(0, savedAreaVisibleVacancyCount);
    const remainingFeatureCount = Math.max(
      0,
      features.length - visibleFeatures.length,
    );
    const currentCoverage = currentVacancyCoverage;
    const savedWorkstation = vacancySpreadsheetScope.drawnArea.workstation;
    const savedVacancyFilterLabels = savedWorkstation
      ? activeAreaVacancyFilterLabels(savedWorkstation.vacancyFilters)
      : [];
    const savedPermitFilterLabels = savedWorkstation
      ? activeAreaPermitFilterLabels(savedWorkstation.permitFilters)
      : [];

    return (
      <motion.div {...fadeIn}>
        <div className="min-h-screen overflow-x-hidden bg-[#F5F5F0] px-2 py-4 print:bg-white sm:px-6 sm:py-8">
          <div className="mx-auto max-w-[1180px] overflow-hidden bg-white shadow-xl print:shadow-none">
            <header className="bg-[#0C1B33] px-5 pb-10 pt-12 sm:px-12 md:px-16">
              <p className="mb-5 font-mono-bureau text-[9px] uppercase tracking-[0.35em] text-white/40">
                Saved Area Analysis · Read-only workstation
              </p>
              <h1 className="mb-3 font-editorial text-3xl leading-tight text-white sm:text-4xl lg:text-[42px]">
                Area Analysis — {savedAreaName}
              </h1>
              <p className="max-w-3xl text-[15px] leading-relaxed text-white/55">
                Review each evidence family separately, then use the source
                links and exports to continue verification. This saved view
                does not turn public records into an availability, ownership,
                zoning, or permit determination.
              </p>
              <div className="mt-6 h-[3px] w-10 bg-white/30" />
            </header>

            <div className="flex flex-wrap gap-x-8 gap-y-3 border-b border-[#0C1B33]/8 px-5 py-5 sm:px-12 md:px-16">
              <div>
                <span className="mb-0.5 block font-mono-bureau text-[8px] uppercase tracking-[0.25em] text-[#0C1B33]/30">
                  Saved
                </span>
                <span className="text-[13px] text-[#0C1B33]">
                  {formattedDate}
                </span>
              </div>
              <div>
                <span className="mb-0.5 block font-mono-bureau text-[8px] uppercase tracking-[0.25em] text-[#0C1B33]/30">
                  Scope
                </span>
                <span className="text-[13px] text-[#0C1B33]">
                  Exact saved polygon
                </span>
              </div>
              <div className="min-w-0">
                <span className="mb-0.5 block font-mono-bureau text-[8px] uppercase tracking-[0.25em] text-[#0C1B33]/30">
                  Boundary fingerprint
                </span>
                <span className="block break-all font-mono-bureau text-[11px] text-[#0C1B33]/65">
                  {vacancySpreadsheetScope.drawnArea.scope.fingerprint}
                </span>
              </div>
            </div>

            <nav
              aria-label="Saved area evidence"
              className="sticky top-0 z-10 border-b border-[#0C1B33]/10 bg-white/95 px-5 py-3 backdrop-blur print:static sm:px-12 md:px-16"
            >
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {[
                  ["Overview", "saved-area-overview"],
                  ["Vacancy", "saved-area-vacancy"],
                  ...(contextSections.length > 0
                    ? [["Area context", "saved-area-context"]]
                    : []),
                  ...(showPermitEvidence
                    ? [["Permit activity", "saved-area-permits"]]
                    : []),
                  ["Sources & methods", "saved-area-sources"],
                ].map(([label, anchor]) => (
                  <a
                    key={anchor}
                    href={`#${anchor}`}
                    className="font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/55 transition-colors hover:text-[#2563EB]"
                  >
                    {label}
                  </a>
                ))}
              </div>
            </nav>

            <main className="space-y-12 px-5 py-10 sm:px-12 md:px-16">
              <section
                id="saved-area-overview"
                className="scroll-mt-20 space-y-6"
              >
                <div>
                  <p className="mb-2 font-mono-bureau text-[9px] uppercase tracking-[0.24em] text-[#2563EB]">
                    01 · Overview
                  </p>
                  <h2 className="font-editorial text-3xl text-[#0C1B33]">
                    What this saved area contains
                  </h2>
                  <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-[#0C1B33]/55">
                    {report.summary}
                  </p>
                </div>

                <div className="border border-[#2563EB]/15 bg-[#EFF6FF] px-4 py-4">
                  <p className="mb-2 font-mono-bureau text-[8px] uppercase tracking-[0.2em] text-[#2563EB]">
                    Saved boundary and current refresh
                  </p>
                  <p className="text-[12px] leading-relaxed text-[#0C1B33]/65">
                    Vacancy records are re-queried inside the exact polygon
                    saved with this report, then filtered under the saved
                    evidence policy. The saved record manifest is retained so
                    additions and removals can be disclosed when the two
                    source snapshots are comparable.
                  </p>
                  {drawnAreaRecordDrift && (
                    <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/50">
                      Generation manifest: {drawnAreaRecordDrift.saved.toLocaleString("en-US")} records. Current polygon result: {drawnAreaRecordDrift.current.toLocaleString("en-US")} ({drawnAreaRecordDrift.added.toLocaleString("en-US")} added, {drawnAreaRecordDrift.removed.toLocaleString("en-US")} removed, {drawnAreaRecordDrift.changedSnapshots.toLocaleString("en-US")} source snapshot changed since save, {drawnAreaRecordDrift.snapshotsNotComparable.toLocaleString("en-US")} shared-record snapshot comparison unavailable).
                    </p>
                  )}
                  {!responsePending &&
                    !drawnAreaRecordDrift &&
                    drawnAreaRecordDriftComparability?.status ===
                      "unavailable" && (
                      <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/50">
                        {drawnAreaRecordDriftComparability.detail}
                      </p>
                    )}
                </div>

                {savedWorkstation && (
                  <div className="grid gap-px bg-[#0C1B33]/8 sm:grid-cols-2">
                    <div className="min-w-0 bg-[#FAF9F6] px-4 py-4">
                      <p className="mb-2 font-mono-bureau text-[8px] uppercase tracking-[0.2em] text-[#0C1B33]/35">
                        Saved vacancy view
                      </p>
                      <p className="break-words text-[12px] leading-relaxed text-[#0C1B33]/65">
                        {savedVacancyFilterLabels.length > 0
                          ? savedVacancyFilterLabels.join(" · ")
                          : "No additional vacancy filters"}
                      </p>
                    </div>
                    <div className="min-w-0 bg-[#FAF9F6] px-4 py-4">
                      <p className="mb-2 font-mono-bureau text-[8px] uppercase tracking-[0.2em] text-[#0C1B33]/35">
                        Saved permit-record view
                      </p>
                      <p className="break-words text-[12px] leading-relaxed text-[#0C1B33]/65">
                        {savedPermitFilterLabels.length > 0
                          ? savedPermitFilterLabels.join(" · ")
                          : "No permit-record filters"}
                      </p>
                    </div>
                    {savedWorkstation.practitionerNotes && (
                      <div className="min-w-0 bg-[#FFFDF8] px-4 py-4 sm:col-span-2">
                        <p className="mb-2 font-mono-bureau text-[8px] uppercase tracking-[0.2em] text-[#0C1B33]/35">
                          Practitioner notes · user-authored
                        </p>
                        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[#0C1B33]/65">
                          {savedWorkstation.practitionerNotes}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-px bg-[#0C1B33]/8 sm:grid-cols-4">
                  {[
                    [
                      "Vacancy signals",
                      spreadsheetCount(vacancySpreadsheetStats.total, "Loading"),
                    ],
                    [
                      "Vacant land",
                      spreadsheetCount(vacancySpreadsheetStats.land, "..."),
                    ],
                    [
                      "Buildings",
                      spreadsheetCount(vacancySpreadsheetStats.buildings, "..."),
                    ],
                    [
                      "Public ownership",
                      spreadsheetCount(
                        vacancySpreadsheetStats.publicOwnership,
                        "...",
                      ),
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 bg-[#FAF9F6] px-4 py-4">
                      <span className="mb-1 block font-mono-bureau text-[8px] uppercase tracking-[0.18em] text-[#0C1B33]/30">
                        {label}
                      </span>
                      <span className="break-words font-mono-bureau text-[17px] text-[#0C1B33]/75">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                {areaSnapshotSection && (
                  <SavedAreaEvidenceSection
                    section={areaSnapshotSection}
                    eyebrow="Saved snapshot"
                  />
                )}
                {additionalSections.map((section) => (
                  <SavedAreaEvidenceSection
                    key={section.id ?? section.title}
                    section={section}
                    eyebrow="Saved report detail"
                  />
                ))}
              </section>

              <section
                id="saved-area-vacancy"
                className="scroll-mt-20 space-y-6"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="mb-2 font-mono-bureau text-[9px] uppercase tracking-[0.24em] text-[#2563EB]">
                      02 · Vacancy
                    </p>
                    <h2 className="font-editorial text-3xl text-[#0C1B33]">
                      Tracked public-record vacancy signals
                    </h2>
                    <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[#0C1B33]/50">
                      These are current records returned inside the saved
                      polygon under the report&apos;s saved evidence and
                      workstation filters. They are signals for follow-up, not
                      a complete inventory of vacant or available property.
                    </p>
                  </div>
                  <button
                    onClick={handleVacancySpreadsheetExport}
                    disabled={
                      isLoadingVacancySpreadsheet ||
                      permitResponsePending ||
                      isExportingVacancySpreadsheet ||
                      !canExportVacancySpreadsheet
                    }
                    className="inline-flex w-full items-center justify-center gap-2 bg-[#0C1B33] px-6 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white transition-colors hover:bg-[#0C1B33]/80 disabled:cursor-default disabled:opacity-50 sm:w-auto"
                  >
                    {isLoadingVacancySpreadsheet ||
                    permitResponsePending ||
                    isExportingVacancySpreadsheet ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    Download CSV
                  </button>
                </div>

                {vacancySpreadsheetError && (
                  <div className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                    {vacancySpreadsheetError} No zero-record claim is being
                    made.
                  </div>
                )}

                {responsePending ? (
                  <div className="border border-[#0C1B33]/10 bg-[#FAF9F6] px-5 py-10 text-center text-[13px] text-[#0C1B33]/40">
                    <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
                    Loading vacancy records...
                  </div>
                ) : vacancySpreadsheetError ? null : features.length > 0 ? (
                  <div className="space-y-3">
                    {visibleFeatures.map((feature, rowIndex) => {
                      const property = feature.properties ?? {};
                      const programName =
                        typeof property.programName === "string" &&
                        property.programName.trim()
                          ? property.programName.trim()
                          : null;
                      const managingOrganization =
                        typeof property.managingOrganization === "string" &&
                        property.managingOrganization.trim()
                          ? property.managingOrganization.trim()
                          : null;
                      const applicationUrl = safeVacancyProgramUrl(
                        property.applicationUrl,
                      );
                      const sourceContext = programContextToText(
                        property.programContext,
                      );
                      const sourceStatus =
                        typeof property.status === "string" &&
                        property.status.trim()
                          ? property.status.trim()
                          : "Not recorded";
                      const sourceLabel = String(
                        property.sourceDatasetLabel ??
                          property.source ??
                          "Source not recorded",
                      );
                      const sourceRecordDate =
                        typeof property.sourceRecordDate === "string" &&
                        property.sourceRecordDate
                          ? property.sourceRecordDate.slice(0, 10)
                          : "Not recorded";
                      const freshnessClass = String(
                        property.freshnessClass ?? "Not classified",
                      ).replaceAll("_", " ");
                      const licenseCheckState = String(
                        property.licenseCheckState ?? "Not recorded",
                      ).replaceAll("_", " ");
                      const hasSourceFollowUp = Boolean(
                        sourceContext ||
                          applicationUrl ||
                          (typeof property.sourceUrl === "string" &&
                            property.sourceUrl),
                      );
                      const squareFeet = Number(property.squareFeet ?? 0);

                      return (
                        <article
                          key={`${property.recordId ?? property.address ?? "property"}-${rowIndex}`}
                          className="min-w-0 border border-[#0C1B33]/10 bg-white px-5 py-5 sm:px-6"
                        >
                          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <p className="font-mono-bureau text-[8px] uppercase tracking-[0.18em] text-[#0C1B33]/35">
                                {property.propertyType === "vacant_land"
                                  ? "Tracked land signal"
                                  : property.propertyType === "vacant_building"
                                    ? "Tracked building signal"
                                    : "Tracked vacancy signal"}
                              </p>
                              <h3 className="mt-1 break-words font-editorial text-2xl text-[#0C1B33]">
                                {String(property.address ?? "Unknown address")}
                              </h3>
                              <p className="mt-2 break-words text-[12px] leading-relaxed text-[#0C1B33]/50">
                                Source: {sourceLabel} · Source status: {sourceStatus}
                                {` · Source record date: ${sourceRecordDate}`}
                                {` · Evidence classification: ${freshnessClass}`}
                                {` · License screen: ${licenseCheckState}`}
                                {programName ? ` · ${programName}` : ""}
                                {managingOrganization
                                  ? ` · Managed by ${managingOrganization}`
                                  : ""}
                              </p>
                            </div>
                            <a
                              href={buildIncentiveAnalysisUrl(feature)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex shrink-0 items-center justify-center gap-1.5 border border-[#2563EB]/25 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB] transition-colors hover:border-[#2563EB]/45 hover:bg-[#2563EB]/5"
                            >
                              <ArrowRight className="h-3 w-3" />
                              Run incentive analysis
                            </a>
                          </div>

                          <dl className="mt-5 grid grid-cols-2 gap-px bg-[#0C1B33]/8 lg:grid-cols-4">
                            {[
                              ["Ward", String(property.ward ?? "Not recorded")],
                              [
                                "Community area",
                                String(property.communityArea ?? "Not recorded"),
                              ],
                              [
                                "Zoning",
                                String(property.zoningClass ?? "Not recorded"),
                              ],
                              [
                                "Recorded square feet",
                                squareFeet > 0
                                  ? squareFeet.toLocaleString("en-US")
                                  : "Not recorded",
                              ],
                            ].map(([label, value]) => (
                              <div key={label} className="min-w-0 bg-[#FAF9F6] px-3 py-3">
                                <dt className="font-mono-bureau text-[7px] uppercase tracking-[0.16em] text-[#0C1B33]/30">
                                  {label}
                                </dt>
                                <dd className="mt-1 break-words text-[12px] text-[#0C1B33]/65">
                                  {value}
                                </dd>
                              </div>
                            ))}
                          </dl>

                          <div className="mt-4 grid min-w-0 gap-3 text-[12px] leading-relaxed text-[#0C1B33]/50 sm:grid-cols-2">
                            <div className="min-w-0 break-words">
                              <span className="font-medium text-[#0C1B33]/70">
                                Ownership context:
                              </span>{" "}
                              {String(property.ownerName ?? "Owner not recorded")}
                              {property.ownerType
                                ? ` · ${String(property.ownerType)}`
                                : ""}
                            </div>
                            <div className="min-w-0 break-words">
                              <span className="font-medium text-[#0C1B33]/70">
                                Incentive-zone matches:
                              </span>{" "}
                              {zoneMatchesToText(property.zoneMatches) ||
                                "No matches recorded"}
                            </div>
                          </div>

                          {hasSourceFollowUp && (
                            <div className="mt-4 min-w-0 border-t border-[#0C1B33]/8 pt-4 text-[11px] leading-relaxed text-[#0C1B33]/45">
                              {sourceContext && (
                                <p className="break-words">
                                  Published program context: {sourceContext}.
                                  Verify current availability and terms.
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                                {typeof property.sourceUrl === "string" &&
                                  property.sourceUrl && (
                                    <a
                                      href={property.sourceUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 break-words text-[#2563EB] hover:underline"
                                    >
                                      {String(
                                        property.sourceDatasetLabel ??
                                          property.source ??
                                          "Source record",
                                      )}
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                  )}
                                {applicationUrl && (
                                  <a
                                    href={applicationUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[#2563EB] hover:underline"
                                  >
                                    Review published program record
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}

                    {remainingFeatureCount > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setSavedAreaVisibleVacancyCount((count) => count + 24)
                        }
                        className="w-full border border-[#0C1B33]/15 bg-[#FAF9F6] px-5 py-3 font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/60 transition-colors hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
                      >
                        Load 24 more · {remainingFeatureCount.toLocaleString("en-US")} remaining
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="border border-[#0C1B33]/10 bg-[#FAF9F6] px-5 py-10 text-center text-[13px] leading-relaxed text-[#0C1B33]/45">
                    {vacancyEmptyStateMessage}
                  </div>
                )}

                {vacancySections.map((section) => (
                  <SavedAreaEvidenceSection
                    key={section.title}
                    section={section}
                    eyebrow="Generation-time vacancy shortlist"
                  />
                ))}
              </section>

              {contextSections.length > 0 && (
                <section
                  id="saved-area-context"
                  className="scroll-mt-20 space-y-6"
                >
                  <div>
                    <p className="mb-2 font-mono-bureau text-[9px] uppercase tracking-[0.24em] text-[#2563EB]">
                      03 · Area context
                    </p>
                    <h2 className="font-editorial text-3xl text-[#0C1B33]">
                      Context carried by the vacancy records
                    </h2>
                    <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[#0C1B33]/50">
                      Zone and ownership counts below are attributes of the
                      displayed vacancy signals. They do not measure complete
                      polygon-wide zone coverage or every owner in the area.
                    </p>
                  </div>
                  {contextSections.map((section) => (
                    <SavedAreaEvidenceSection
                      key={section.title}
                      section={section}
                      eyebrow="Vacancy-record context"
                    />
                  ))}
                </section>
              )}

              {showPermitEvidence && (
                <section
                  id="saved-area-permits"
                  className="scroll-mt-20 space-y-6"
                >
                  <div>
                    <p className="mb-2 font-mono-bureau text-[9px] uppercase tracking-[0.24em] text-[#2563EB]">
                      {contextSections.length > 0 ? "04" : "03"} · Permit activity
                    </p>
                    <h2 className="font-editorial text-3xl text-[#0C1B33]">
                      Saved permit filing context
                    </h2>
                    <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[#0C1B33]/50">
                      Permit figures are the source-separated, geocoded filing
                      context attached when this report was saved. A filing
                      does not prove construction started, finished, or remains
                      active.
                    </p>
                  </div>
                  {isLoadingSavedAreaPermit && (
                    <div className="border border-[#0C1B33]/10 bg-[#FAF9F6] px-5 py-4 text-[13px] leading-relaxed text-[#0C1B33]/50">
                      Refreshing current permit records for the saved polygon...
                    </div>
                  )}
                  {savedAreaPermitError && (
                    <div className="border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] leading-relaxed text-amber-900/75">
                      {savedAreaPermitError}
                    </div>
                  )}
                  {permitSections.length > 0 ? (
                    permitSections.map((section) => (
                      <SavedAreaEvidenceSection
                        key={section.title}
                        section={section}
                        eyebrow="Saved permit evidence"
                      />
                    ))
                  ) : (
                    <div className="border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] leading-relaxed text-amber-900/75">
                      Permit evidence was unavailable when this report was
                      saved. No zero-activity claim is being made.
                    </div>
                  )}
                </section>
              )}

              <section
                id="saved-area-sources"
                className="scroll-mt-20 space-y-6"
              >
                <div>
                  <p className="mb-2 font-mono-bureau text-[9px] uppercase tracking-[0.24em] text-[#2563EB]">
                    {showPermitEvidence
                      ? contextSections.length > 0
                        ? "05"
                        : "04"
                      : contextSections.length > 0
                        ? "04"
                        : "03"}{" "}
                    · Sources & methods
                  </p>
                  <h2 className="font-editorial text-3xl text-[#0C1B33]">
                    Verify the evidence at its source
                  </h2>
                  <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[#0C1B33]/50">
                    Source families remain separate throughout this report.
                    Refresh and coverage dates describe the Explorer&apos;s
                    retrieval, not a guarantee that every upstream record is
                    current or complete.
                  </p>
                </div>

                {provenanceSections.map((section) => (
                  <SavedAreaEvidenceSection
                    key={section.title}
                    section={section}
                    eyebrow="Boundary provenance"
                  />
                ))}

                <div className="grid gap-3 sm:grid-cols-2">
                  {report.dataSources?.map((source) => (
                    <article
                      key={source.id}
                      className="min-w-0 border border-[#0C1B33]/10 bg-white px-5 py-5"
                    >
                      <p className="font-mono-bureau text-[8px] uppercase tracking-[0.18em] text-[#0C1B33]/30">
                        Public source
                      </p>
                      <h3 className="mt-2 break-words text-[15px] font-medium text-[#0C1B33]/80">
                        {source.label}
                      </h3>
                      <p className="mt-2 break-words text-[12px] leading-relaxed text-[#0C1B33]/50">
                        {source.description}
                      </p>
                      {source.url && (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB] hover:underline"
                        >
                          Open source
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </article>
                  ))}
                </div>

                <div className="border border-[#0C1B33]/10 bg-[#FAF9F6] px-5 py-4 text-[12px] leading-relaxed text-[#0C1B33]/55">
                  <span className="font-medium text-[#0C1B33]/75">
                    Current vacancy refresh:
                  </span>{" "}
                  {currentCoverage
                    ? `${currentCoverage.coverageStatus} coverage from ${currentCoverage.sourcePath}. ${currentCoverage.returnedCount.toLocaleString("en-US")} record${currentCoverage.returnedCount === 1 ? "" : "s"} returned before saved display filters; license screening ${currentCoverage.licenseScreening.status}.`
                    : "Coverage metadata is unavailable until the exact-polygon refresh completes."}
                </div>
                <div className="border border-[#0C1B33]/10 bg-[#FAF9F6] px-5 py-4 text-[12px] leading-relaxed text-[#0C1B33]/55">
                  <span className="font-medium text-[#0C1B33]/75">
                    Current permit refresh:
                  </span>{" "}
                  {savedAreaPermitAnalysis
                    ? `${formatPermitAreaCoverageLabel(savedAreaPermitAnalysis)}. ${savedAreaPermitAnalysis.records.length.toLocaleString("en-US")} recent record${savedAreaPermitAnalysis.records.length === 1 ? "" : "s"} returned for record-level filtering; full-polygon aggregates cover ${savedAreaPermitAnalysis.totalFilings.toLocaleString("en-US")} geocoded filing${savedAreaPermitAnalysis.totalFilings === 1 ? "" : "s"}.`
                    : savedAreaPermitError
                      ? "Unavailable. The CSV identifies this failed lookup explicitly and does not report zero permit activity."
                      : "Refreshing current records for the exact saved polygon."}
                </div>
              </section>
            </main>
          </div>

          <div className="mx-auto mt-8 max-w-[1180px] print:hidden">
            <div className="flex flex-col flex-wrap items-center justify-center gap-3 sm:flex-row">
              <button
                onClick={handlePrint}
                className="inline-flex w-full items-center justify-center gap-2 bg-[#0C1B33] px-8 py-3.5 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white shadow-md transition-colors hover:bg-[#0C1B33]/80 sm:w-auto"
              >
                <Printer className="h-3.5 w-3.5" />
                Download PDF
              </button>
              <button
                onClick={handleSaveReport}
                className="inline-flex w-full items-center justify-center gap-2 bg-[#2563EB] px-8 py-3.5 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white shadow-md transition-colors hover:bg-[#1d4ed8] sm:w-auto"
              >
                <FileText className="h-3.5 w-3.5" />
                Save Report
              </button>
              <StartPreparationPacketButton
                report={report}
                wizardState={reportWizardState}
                source={`${analyticsSource}_area_actions`}
                className="w-full px-8 py-3.5 shadow-md sm:w-auto"
              />
              <button
                onClick={handleEmailReportClick}
                className="inline-flex w-full items-center justify-center gap-2 border border-[#2563EB]/30 bg-white px-8 py-3.5 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#2563EB] shadow-md transition-colors hover:border-[#2563EB]/50 hover:bg-[#2563EB]/5 sm:w-auto"
              >
                <Mail className="h-3.5 w-3.5" />
                Email This to Me
              </button>
              <button
                onClick={onStartOver}
                className="inline-flex w-full items-center justify-center gap-2 border border-[#0C1B33]/15 bg-white px-8 py-3.5 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/60 shadow-md transition-colors hover:border-[#0C1B33]/30 hover:text-[#0C1B33] sm:w-auto"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                New Search
              </button>
            </div>
          </div>
        </div>

        {downloadGateOpen && (
          <DownloadGateModal
            reportAddress={report.metadata?.address}
            reportTitle={report.title}
            onDownload={handleDownloadAfterCapture}
            onClose={() => setDownloadGateOpen(false)}
          />
        )}
        {emailDialogOpen && (
          <EmailReportModal
            report={report}
            onClose={() => setEmailDialogOpen(false)}
            onSent={() =>
              trackEvent(
                "report_emailed",
                reportAnalyticsPayload(report, "report_email_modal"),
              )
            }
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
                        {vacancyEmptyStateMessage}
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

/**
 * The legacy mid-report vacancy-spreadsheet summary card: locale-level
 * stats + a CSV export button, shown inline within the main report body
 * (below the persona chrome, above the Verdict Card) for reports that
 * carry a community-area vacancy locale but aren't rendering the full
 * VacancySpreadsheetSection view (i.e. `compact` reports and persona
 * boards never show it; the full-page view above pre-empts it otherwise).
 *
 * Gate-review finding (2026-08-29): this predates commit 78ea06f — the
 * 309-line block that commit added was never the ONLY duplicate; this
 * card was already byte-identical between both forks before that commit,
 * which is why the original 309-line count missed it. Extracted here so
 * the fork-fence guard's signature scan (drawn from this file's own
 * source) covers it too.
 */
export function VacancySpreadsheetSummaryCard({
  compact,
  showPersonaView,
  vacancy,
}: {
  compact?: boolean;
  showPersonaView: boolean;
  vacancy: VacancySpreadsheetSectionData;
}) {
  const {
    vacancySpreadsheetLocale,
    vacancySpreadsheetStats,
    vacancySpreadsheetError,
    isLoadingVacancySpreadsheet,
    isExportingVacancySpreadsheet,
    handleVacancySpreadsheetExport,
  } = vacancy;

  if (compact || showPersonaView || !vacancySpreadsheetLocale) return null;

  return (
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
  );
}

/**
 * The legacy bottom-CTA-row "Vacancy Spreadsheet" download button —
 * another pre-78ea06f duplicate found in the same gate-review pass as
 * VacancySpreadsheetSummaryCard above. Deliberately just this one button,
 * not the whole CTA row it sits in: the surrounding Save/Email/Share/New
 * Search buttons are generic report-anatomy shared by every report type
 * (not vacancy/drawn-area-specific), out of this component's scope.
 */
export function VacancySpreadsheetCsvCtaButton({
  vacancy,
}: {
  vacancy: VacancySpreadsheetSectionData;
}) {
  const { vacancySpreadsheetLocale, isExportingVacancySpreadsheet, handleVacancySpreadsheetExport } = vacancy;
  if (!vacancySpreadsheetLocale) return null;

  return (
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
  );
}
