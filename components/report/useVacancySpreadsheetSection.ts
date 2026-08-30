import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WizardState } from "@/lib/report-wizard-config";
import type { GeneratedReport } from "@/lib/report-engine";
import {
  buildDrawnAreaCsv,
  drawnAreaFilenameSlug,
} from "@/lib/polygon-investment";
import {
  buildVacancySpreadsheetCsv,
  downloadCsv,
  slugifyFilePart,
  type VacancySpreadsheetFeature,
} from "@/lib/vacancy-spreadsheet";
import { filterAreaVacancyFeatures } from "@/lib/area-vacancy-presentation";
import {
  activeAreaPermitFilterLabels,
  activeAreaVacancyFilterLabels,
  filterAreaPermitWorkstationRecords,
  filterAreaVacancyWorkstationFeatures,
} from "@/lib/area-analysis-workstation";
import {
  fetchPermitArea,
  type PermitAreaResult,
} from "@/lib/permit-area";
import {
  assessDrawnAreaRecordDriftComparability,
  compareDrawnAreaRecordManifest,
  hasCompleteCurrentDrawnAreaSelection,
  resolveVacancySpreadsheetScope,
  type VacancySpreadsheetScope,
} from "@/lib/vacancy-spreadsheet-scope";
import {
  parseDrawnAreaVacancyResponse,
  type VacancyCoverageMetadata,
} from "@/lib/drawn-area-vacancy";

/**
 * Shared state/effects/handlers for the drawn-area / vacancy-spreadsheet
 * report surface. Both report forks (app/report/page.tsx's local
 * `ReportDisplay` and the exported `components/report/ReportDisplay.tsx`)
 * call this ONE hook so the fetch/export/permit-refresh behavior — and the
 * "area analysis workstation" it feeds — can never drift between them
 * again. See components/report/VacancySpreadsheetSection.tsx for the
 * paired renderer, and docs/persona-report-parity.md for the parity-by-
 * construction ruling this pair implements.
 *
 * Extracted verbatim from components/report/ReportDisplay.tsx (the fuller
 * of the two forks as of this extraction — it already carried the saved-
 * area permit refresh and workstation-filter behavior that
 * app/report/page.tsx's fork never gained). Zero behavior change for
 * either fork: see the extraction PR description for the reachability
 * evidence that app/report/page.tsx could never observe a difference.
 */
export function useVacancySpreadsheetSection(
  report: GeneratedReport,
  reportWizardState: WizardState | undefined,
  compact: boolean | undefined,
) {
  const [isExportingVacancySpreadsheet, setIsExportingVacancySpreadsheet] =
    useState(false);
  const [isLoadingVacancySpreadsheet, setIsLoadingVacancySpreadsheet] =
    useState(false);
  const [vacancySpreadsheetFeatures, setVacancySpreadsheetFeatures] =
    useState<VacancySpreadsheetFeature[] | null>(null);
  const [vacancySpreadsheetError, setVacancySpreadsheetError] =
    useState<string | null>(null);
  const [savedAreaPermitAnalysis, setSavedAreaPermitAnalysis] =
    useState<PermitAreaResult | null>(null);
  const [savedAreaPermitError, setSavedAreaPermitError] =
    useState<string | null>(null);
  const [isLoadingSavedAreaPermit, setIsLoadingSavedAreaPermit] =
    useState(false);
  const [savedAreaVisibleVacancyCount, setSavedAreaVisibleVacancyCount] =
    useState(24);
  const vacancySpreadsheetCoverageRef =
    useRef<VacancyCoverageMetadata | null>(null);

  useEffect(() => {
    setSavedAreaVisibleVacancyCount(24);
  }, [report.generatedAt, report.title]);

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
      ? vacancySpreadsheetScope.label
      : vacancySpreadsheetLocale;
  const vacancySpreadsheetRequestPath =
    vacancySpreadsheetScope.status === "ready"
      ? vacancySpreadsheetScope.requestPath
      : "";

  useEffect(() => {
    if (
      compact ||
      vacancySpreadsheetScope.status !== "ready" ||
      vacancySpreadsheetScope.kind !== "drawn-area"
    ) {
      setSavedAreaPermitAnalysis(null);
      setSavedAreaPermitError(null);
      setIsLoadingSavedAreaPermit(false);
      return;
    }

    const controller = new AbortController();
    setSavedAreaPermitAnalysis(null);
    setSavedAreaPermitError(null);
    setIsLoadingSavedAreaPermit(true);

    fetchPermitArea(vacancySpreadsheetScope.drawnArea.scope.geometry, {
      signal: controller.signal,
    })
      .then((analysis) => {
        if (!controller.signal.aborted) {
          setSavedAreaPermitAnalysis(analysis);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[report] saved-area permit refresh failed:", error);
        setSavedAreaPermitAnalysis(null);
        setSavedAreaPermitError(
          "Current permit records could not be refreshed. The saved report remains visible, but the CSV will mark current permit coverage unavailable rather than report zero filings.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingSavedAreaPermit(false);
        }
      });

    return () => controller.abort();
  }, [compact, vacancySpreadsheetScope]);

  const vacancyFeaturesForScope = useCallback(
    (features: VacancySpreadsheetFeature[]): VacancySpreadsheetFeature[] => {
      if (
        vacancySpreadsheetScope.status !== "ready" ||
        vacancySpreadsheetScope.kind !== "drawn-area"
      ) {
        return features;
      }
      const filters = vacancySpreadsheetScope.drawnArea.provenance.vacancy.filters;
      const evidencePolicyFeatures = filterAreaVacancyFeatures(
        features as GeoJSON.Feature[],
        filters.freshness,
        filters.license,
      ) as VacancySpreadsheetFeature[];
      const workstation = vacancySpreadsheetScope.drawnArea.workstation;
      if (!workstation) return evidencePolicyFeatures;
      return filterAreaVacancyWorkstationFeatures(
        evidencePolicyFeatures as GeoJSON.Feature[],
        workstation.vacancyFilters,
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

      if (
        vacancySpreadsheetScope.status === "ready" &&
        vacancySpreadsheetScope.kind === "drawn-area"
      ) {
        const drawnArea = vacancySpreadsheetScope.drawnArea;
        const workstation = drawnArea.workstation;
        const permitFilters = workstation?.permitFilters;
        const permitRecords = savedAreaPermitAnalysis
          ? permitFilters
            ? filterAreaPermitWorkstationRecords(
                savedAreaPermitAnalysis.records,
                permitFilters,
              )
            : savedAreaPermitAnalysis.records
          : [];
        const vacancyFilterLabels = workstation
          ? activeAreaVacancyFilterLabels(workstation.vacancyFilters)
          : [];
        const permitFilterLabels = permitFilters
          ? activeAreaPermitFilterLabels(permitFilters)
          : [];

        downloadCsv(
          buildDrawnAreaCsv({
            areaName: vacancySpreadsheetDisplayName,
            practitionerNotes: workstation?.practitionerNotes,
            scopeProvenance: {
              fingerprint: drawnArea.scope.fingerprint,
              selectionMethod: "point_in_saved_polygon",
              generatedAt: drawnArea.generatedAt,
              manifestSelectedCount:
                drawnArea.provenance.vacancy.selectedCount,
            },
            vacancyFeatures: features as GeoJSON.Feature[],
            vacancyReturnedCountBeforeFilters:
              vacancySpreadsheetCoverageRef.current?.returnedCount ??
              drawnArea.provenance.vacancy.returnedCountBeforeFilters ??
              features.length,
            vacancyFilterLabels,
            vacancyVisibleCount: features.length,
            vacancyFreshnessFilter:
              drawnArea.provenance.vacancy.filters.freshness,
            vacancyLicenseFilter:
              drawnArea.provenance.vacancy.filters.license,
            vacancyCoverage: vacancySpreadsheetCoverageRef.current,
            permitArea: savedAreaPermitAnalysis,
            permitRecords,
            permitRecordsBeforeFilters:
              savedAreaPermitAnalysis?.records.length,
            permitFilterLabels,
            permitVisibleCount: savedAreaPermitAnalysis
              ? permitRecords.length
              : undefined,
            permitLoadFailed: savedAreaPermitError !== null,
            investment: null,
          }),
          `area-report-${drawnAreaFilenameSlug(vacancySpreadsheetDisplayName)}-${new Date().toISOString().slice(0, 10)}.csv`,
        );
        return;
      }

      downloadCsv(
        buildVacancySpreadsheetCsv(features, {
          selectionMethod: "community_area_boundary",
          currentCclbaSourceCoverage:
            vacancySpreadsheetCoverageRef.current?.cclbaSourceCoverage,
        }),
        `vacant-properties-${slugifyFilePart(vacancySpreadsheetDisplayName)}-${new Date().toISOString().slice(0, 10)}.csv`,
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
    savedAreaPermitAnalysis,
    savedAreaPermitError,
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

  // react-hooks/refs: a ref object must never be handed to another
  // component to read `.current` during ITS render (only the component/hook
  // that called useRef may do that) — so this hook reads the ref itself,
  // here, at its own render time (fresh every call, same as reading it
  // inline used to be) and returns the plain resolved value instead of the
  // ref object. Every caller below already only needed the current value.
  const currentVacancyCoverage = vacancySpreadsheetCoverageRef.current;

  return {
    vacancySpreadsheetScope,
    isDrawnAreaReport,
    vacancySpreadsheetLocale,
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
  };
}

export type VacancySpreadsheetSectionData = ReturnType<
  typeof useVacancySpreadsheetSection
>;

export type { VacancySpreadsheetScope };
