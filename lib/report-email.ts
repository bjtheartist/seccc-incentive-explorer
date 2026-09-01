import type { GeneratedReport } from "./report-engine";
import {
  projectGoalDisplayLabel,
  selectedProjectGoals,
} from "./report-wizard-config";
import { MAX_PDF_BASE64_CHARS, REPORT_TOO_LARGE_MESSAGE } from "./report-email-limits";

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
 * A report that genuinely will not fit in an email.
 *
 * Thrown BEFORE the request is sent, from a size pre-check, and marked
 * `retryable: false` — because retrying sends the same bytes and fails the
 * same way. Previously this case produced the generic
 * "We could not email the report. Please try again." message, which is both
 * untrue (trying again cannot help) and unhelpful (it hides the download,
 * which has no size limit). Worse, the payloads it applied to exceeded
 * Vercel's 4.5MB body limit, so the request never reached the route: the
 * browser saw an opaque platform rejection rather than any message this code
 * chose.
 */
export class ReportEmailTooLargeError extends Error {
  readonly retryable = false;
  readonly pdfBase64Length: number;

  constructor(pdfBase64Length: number) {
    super(REPORT_TOO_LARGE_MESSAGE);
    this.name = "ReportEmailTooLargeError";
    this.pdfBase64Length = pdfBase64Length;
  }
}

/**
 * How long to wait on /api/email-report before giving up.
 *
 * The fetch had no timeout at all: a hung connection left the caller awaiting
 * a promise that would never settle, so the modal's "Sending…" state was
 * terminal — no error, no retry, nothing. 30s is comfortably longer than a
 * successful multi-megabyte upload plus Resend's own round trip.
 */
const EMAIL_REQUEST_TIMEOUT_MS = 30_000;

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

  // Size pre-check, BEFORE the upload. Above this the request exceeds Vercel's
  // body limit and is rejected by the platform before the route runs, so
  // sending it can only produce an opaque failure. Fail here instead, with a
  // message that is true and names the download as the way forward.
  if (base64.length > MAX_PDF_BASE64_CHARS) {
    throw new ReportEmailTooLargeError(base64.length);
  }

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
    signal: AbortSignal.timeout(EMAIL_REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as ReportEmailResponse;

  if (!response.ok || !body.success) {
    throw new Error(body.error || "We could not email the report. Please try again.");
  }

  return body;
}
