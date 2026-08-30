import type { ReactNode } from "react";
import { Check, FileText, Link2, Mail, Printer } from "lucide-react";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import { getReportActionPolicy } from "@/lib/report-action-policy";

export interface ReportActionButtonsProps {
  report: GeneratedReport;
  wizardState?: WizardState;
  isDrawnAreaReport: boolean;
  linkCopied: boolean;
  onDownload: () => void;
  onSave: () => void;
  onEmail: () => void;
  onShare: () => void;
  /** Existing report-specific controls that follow Save in the action row. */
  afterSave?: ReactNode;
  /** Existing report-specific controls that follow Email in the action row. */
  afterEmail?: ReactNode;
}

/**
 * The generic Download / Save / Email / Share controls shared by both report
 * renderers. Slots keep each renderer's preparation, watch, and CSV controls
 * in their established positions without duplicating the generic buttons.
 */
export function ReportActionButtons({
  report,
  wizardState,
  isDrawnAreaReport,
  linkCopied,
  onDownload,
  onSave,
  onEmail,
  onShare,
  afterSave,
  afterEmail,
}: ReportActionButtonsProps) {
  const policy = getReportActionPolicy(report, wizardState, isDrawnAreaReport);

  return (
    <>
      <button
        onClick={onDownload}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#0C1B33]/80 transition-colors cursor-pointer shadow-md"
      >
        <Printer className="w-3.5 h-3.5" />
        Download PDF
      </button>
      <button
        onClick={onSave}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#2563EB] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#1d4ed8] transition-colors cursor-pointer shadow-md"
      >
        <FileText className="w-3.5 h-3.5" />
        {policy.saveLabel}
      </button>
      {afterSave}
      <button
        onClick={onEmail}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#2563EB]/30 text-[#2563EB] font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:bg-[#2563EB]/5 hover:border-[#2563EB]/50 transition-colors cursor-pointer shadow-md"
      >
        <Mail className="w-3.5 h-3.5" />
        {policy.emailLabel}
      </button>
      {afterEmail}
      {policy.canShare && (
        <button
          onClick={onShare}
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
    </>
  );
}
