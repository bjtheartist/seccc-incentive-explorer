import type { GeneratedReport } from "./report-engine";
import {
  projectGoalDisplayLabel,
  selectedProjectGoals,
} from "./report-wizard-config";

export interface ReportEmailIdentity {
  email: string;
  name?: string;
  wantsHelp: boolean;
  projectType: string;
  projectGoals: string[];
  customGoal?: string;
}

interface DeliverReportByEmailInput extends ReportEmailIdentity {
  report: GeneratedReport;
  source: string;
  website?: string;
}

interface ReportEmailResponse {
  success?: boolean;
  error?: string;
  dryRun?: boolean;
}

/**
 * Unique program count for a report (F14, build-spec.md 2.4: "Programs
 * surfaced" must count distinct programIds, never `sections.length` — a
 * section count and a program count are different numbers, and the whole
 * point of the audit finding was that one email path silently swapped one
 * for the other). Exported so every email/count entry point
 * (ReportModals, MapPolygonPanel, this module's own email) shares exactly
 * one implementation.
 */
export function programCount(report: GeneratedReport): number {
  const ids = new Set<string>();
  for (const section of report.sections || []) {
    for (const item of section.items || []) {
      if (item.programId) ids.add(item.programId);
    }
  }
  return ids.size;
}

function addressZip(address?: string): string | undefined {
  return address?.match(/\b(606\d{2})\b/)?.[1];
}

export function reportEmailGateKey(report: GeneratedReport): string {
  const lat = report.metadata?.lat?.toFixed(5) || "";
  const lon = report.metadata?.lon?.toFixed(5) || "";
  const address = (report.metadata?.address || report.title).trim().toLowerCase();
  return [report.reportType, lat, lon, address].join("|");
}

export function reportRequiresEmailGate(report: GeneratedReport): boolean {
  return report.reportType === "site-incentives"
    || report.reportType === "location-incentives";
}

export async function deliverReportByEmail({
  report,
  email,
  name,
  wantsHelp,
  projectType,
  projectGoals,
  customGoal,
  source,
  website = "",
}: DeliverReportByEmailInput): Promise<ReportEmailResponse> {
  const { generateReportPdfBase64 } = await import("./pdf-report");
  const { base64, filename } = generateReportPdfBase64(report);
  const address = report.metadata?.address;
  const normalizedGoals = selectedProjectGoals({ projectGoals, projectType });
  const projectGoal = normalizedGoals
    .map((goalId) => projectGoalDisplayLabel(goalId, customGoal))
    .join(", ");

  const response = await fetch("/api/email-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      name: name?.trim() || undefined,
      wantsHelp,
      projectGoal: projectGoal || projectType,
      projectType: normalizedGoals[0] || projectType,
      projectGoals: normalizedGoals,
      customGoal: customGoal?.trim() || undefined,
      source,
      website,
      pdfBase64: base64,
      filename,
      businessName: report.title,
      address,
      zipCode: addressZip(address),
      reportType: report.reportType,
      incentiveCount: programCount(report),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as ReportEmailResponse;

  if (!response.ok || !body.success) {
    throw new Error(body.error || "We could not email the report. Please try again.");
  }

  return body;
}
