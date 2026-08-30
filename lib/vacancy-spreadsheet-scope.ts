import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import {
  resolveDrawnAreaReportScope,
  type DrawnAreaReportScope,
} from "@/lib/drawn-area-report-scope";
import { drawnAreaVacancyRequestPath } from "@/lib/drawn-area-vacancy";
import type { VacancyCoverageMetadata } from "@/lib/drawn-area-vacancy";
import { isVacancyReport } from "@/lib/report-action-policy";

export type VacancySpreadsheetScope =
  | {
      status: "ready";
      kind: "drawn-area";
      label: string;
      requestPath: string;
      drawnArea: DrawnAreaReportScope;
    }
  | {
      status: "ready";
      kind: "community-area";
      label: string;
      requestPath: string;
      drawnArea: null;
    }
  | {
      status: "unavailable";
      kind: "drawn-area";
      reason: "legacy-scope-missing" | "malformed-scope";
      detail: string;
    }
  | { status: "none" };

/**
 * Resolve the exact geography used by the vacancy spreadsheet/report export.
 * An explicit or legacy drawn-area marker is terminal: it can never fall
 * through to the wizard's neighborhood/community-area string.
 */
export function resolveVacancySpreadsheetScope(
  report: GeneratedReport,
  wizardState?: WizardState,
): VacancySpreadsheetScope {
  const drawnArea = resolveDrawnAreaReportScope(report);
  if (drawnArea.status === "ready") {
    return {
      status: "ready",
      kind: "drawn-area",
      label: drawnArea.scope.name,
      requestPath: drawnAreaVacancyRequestPath(drawnArea.scope.scope.geometry),
      drawnArea: drawnArea.scope,
    };
  }
  if (drawnArea.status === "unavailable") {
    return {
      status: "unavailable",
      kind: "drawn-area",
      reason: drawnArea.reason,
      detail: drawnArea.detail,
    };
  }

  const locale = isVacancyReport(report)
    ? wizardState?.neighborhood?.trim() ?? ""
    : "";
  if (!locale) return { status: "none" };

  return {
    status: "ready",
    kind: "community-area",
    label: locale,
    requestPath: `/api/vacant?communityArea=${encodeURIComponent(locale)}&limit=10000`,
    drawnArea: null,
  };
}

export interface DrawnAreaRecordDrift {
  saved: number;
  current: number;
  added: number;
  removed: number;
  changedSnapshots: number;
  snapshotsNotComparable: number;
  unchanged: number;
}

export type DrawnAreaRecordDriftComparability =
  | { status: "comparable" }
  | {
      status: "unavailable";
      reason:
        | "saved-vacancy-unavailable"
        | "saved-coverage-incomplete"
        | "current-coverage-incomplete"
        | "saved-license-screening-incomplete"
        | "current-license-screening-incomplete";
      detail: string;
    };

/** Whether a current response can support exact counts and a clean zero. */
export function hasCompleteCurrentDrawnAreaSelection(
  scope: DrawnAreaReportScope,
  currentCoverage: VacancyCoverageMetadata | null,
): boolean {
  return (
    currentCoverage?.coverageStatus === "complete" &&
    (scope.provenance.vacancy.filters.license !== "conflicts" ||
      currentCoverage.licenseScreening.status === "available")
  );
}

/**
 * A record-manifest delta is meaningful only when the generation query and
 * the re-query cover the same complete evidence policy. Conflict-only views
 * additionally require complete exact-address license screening on both ends.
 */
export function assessDrawnAreaRecordDriftComparability(
  scope: DrawnAreaReportScope,
  currentCoverage: VacancyCoverageMetadata | null,
): DrawnAreaRecordDriftComparability {
  const savedVacancy = scope.provenance.vacancy;
  if (savedVacancy.status !== "ready") {
    return {
      status: "unavailable",
      reason: "saved-vacancy-unavailable",
      detail:
        "The vacancy lookup was unavailable when this report was saved, so there is no generation-time manifest. Current rows are shown as a recheck and are not labeled as additions.",
    };
  }
  if (savedVacancy.coverage?.status !== "complete") {
    return {
      status: "unavailable",
      reason: "saved-coverage-incomplete",
      detail: `Saved vacancy coverage was ${savedVacancy.coverage?.status ?? "not recorded"}. Record drift is withheld because incomplete generation coverage cannot establish true additions.`,
    };
  }
  if (currentCoverage?.coverageStatus !== "complete") {
    return {
      status: "unavailable",
      reason: "current-coverage-incomplete",
      detail: `Current vacancy coverage is ${currentCoverage?.coverageStatus ?? "unavailable"}. Record drift is withheld because an incomplete response cannot establish true removals or a clean zero.`,
    };
  }
  if (savedVacancy.filters.license === "conflicts") {
    if (savedVacancy.coverage.licenseScreeningStatus !== "available") {
      return {
        status: "unavailable",
        reason: "saved-license-screening-incomplete",
        detail: `Saved license-conflict screening was ${savedVacancy.coverage.licenseScreeningStatus}. Record drift is withheld because the generation-time conflict selection was not completely screened.`,
      };
    }
    if (currentCoverage.licenseScreening.status !== "available") {
      return {
        status: "unavailable",
        reason: "current-license-screening-incomplete",
        detail: `Current license-conflict screening is ${currentCoverage.licenseScreening.status}. Record drift is withheld because the current conflict selection was not completely screened.`,
      };
    }
  }
  return { status: "comparable" };
}

/** Permit only browser-safe http(s) links from vacancy program metadata. */
export function safeVacancyProgramUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Compare current API records with the compact generation-time manifest. */
export function compareDrawnAreaRecordManifest(
  scope: DrawnAreaReportScope,
  features: readonly { properties?: Record<string, unknown> | null }[],
): DrawnAreaRecordDrift {
  const saved = new Map(
    scope.provenance.vacancy.recordRefsAtGeneration.map((ref) => [
      ref.recordId,
      ref.sourceSnapshotId ?? null,
    ]),
  );
  const current = new Map(
    features.flatMap((feature) => {
      const raw = feature.properties?.recordId ?? feature.properties?.id;
      const recordId = typeof raw === "string" ? raw.trim() : "";
      const rawSnapshot = feature.properties?.sourceSnapshotId;
      const sourceSnapshotId =
        typeof rawSnapshot === "string" && rawSnapshot.trim()
          ? rawSnapshot.trim()
          : null;
      return recordId ? [[recordId, sourceSnapshotId] as const] : [];
    }),
  );
  let unchanged = 0;
  let changedSnapshots = 0;
  let snapshotsNotComparable = 0;
  let common = 0;
  for (const [recordId, sourceSnapshotId] of current) {
    if (!saved.has(recordId)) continue;
    common += 1;
    const savedSnapshotId = saved.get(recordId) ?? null;
    if (savedSnapshotId === null || sourceSnapshotId === null) {
      snapshotsNotComparable += 1;
    } else if (savedSnapshotId === sourceSnapshotId) {
      unchanged += 1;
    } else {
      changedSnapshots += 1;
    }
  }
  return {
    saved: saved.size,
    current: current.size,
    added: current.size - common,
    removed: saved.size - common,
    changedSnapshots,
    snapshotsNotComparable,
    unchanged,
  };
}
