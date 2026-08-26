"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { WizardState } from "@/lib/report-wizard-config";
import {
  normalizeSavedReport,
  stampReportSchemaVersion,
} from "@/lib/report-schema";
import { SaveReportModal, type PendingSavedReport } from "./SaveReportModal";

const PENDING_REPORT_KEY = "csim.pendingReport";

export function storePendingReport(payload: PendingSavedReport) {
  localStorage.setItem(
    PENDING_REPORT_KEY,
    JSON.stringify({
      ...payload,
      reportData: stampReportSchemaVersion(payload.reportData),
    }),
  );
}

export function PendingReportSaver() {
  const params = useSearchParams();
  const [pending, setPending] = useState<PendingSavedReport | null>(() => {
    if (params.get("savePending") !== "1") return null;

    const raw = localStorage.getItem(PENDING_REPORT_KEY);
    if (!raw) return null;

    // localStorage is persisted report JSON too: it can survive a deploy that
    // changed the report shape, so it gets the same normalization boundary as
    // a saved row rather than a blind cast.
    try {
      const parsed: unknown = JSON.parse(raw);
      const payload = parsed as { reportData?: unknown; wizardState?: unknown } | null;
      const normalized = normalizeSavedReport(payload?.reportData);
      if (!normalized.ok) {
        localStorage.removeItem(PENDING_REPORT_KEY);
        return null;
      }
      return {
        reportData: normalized.report,
        wizardState: payload?.wizardState as WizardState | undefined,
      };
    } catch {
      localStorage.removeItem(PENDING_REPORT_KEY);
      return null;
    }
  });

  if (!pending) return null;

  return (
    <SaveReportModal
      reportData={pending.reportData}
      wizardState={pending.wizardState}
      onClose={() => {
        localStorage.removeItem(PENDING_REPORT_KEY);
        setPending(null);
      }}
    />
  );
}
