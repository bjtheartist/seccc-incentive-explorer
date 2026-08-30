import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";

type ReportActionSubject = Pick<GeneratedReport, "reportType" | "title">;

export interface ReportActionPolicy {
  isVacancyReport: boolean;
  saveLabel: "Save Report" | "Save to Workspace";
  emailLabel: "Email This to Me" | "Email Report";
  canShare: boolean;
}

/**
 * One report-category definition for presentation and vacancy export policy.
 * The title fallback preserves compatibility with reports saved before the
 * current report-type taxonomy was complete.
 */
export function isVacancyReport(report: ReportActionSubject): boolean {
  return (
    report.reportType === "dev-feasibility" ||
    report.reportType === "best-location" ||
    report.title.toLowerCase().includes("vacancy")
  );
}

/** Resolve the generic report-action copy and share availability. */
export function getReportActionPolicy(
  report: ReportActionSubject,
  wizardState: WizardState | undefined,
  isDrawnAreaReport: boolean,
): ReportActionPolicy {
  const vacancyReport = isVacancyReport(report);

  return {
    isVacancyReport: vacancyReport,
    saveLabel: vacancyReport ? "Save Report" : "Save to Workspace",
    emailLabel: vacancyReport ? "Email This to Me" : "Email Report",
    canShare: Boolean(wizardState) && !isDrawnAreaReport,
  };
}
