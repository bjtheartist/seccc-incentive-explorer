"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { SaveReportModal, type PendingSavedReport } from "./SaveReportModal";

const PENDING_REPORT_KEY = "csim.pendingReport";

export function storePendingReport(payload: PendingSavedReport) {
  localStorage.setItem(PENDING_REPORT_KEY, JSON.stringify(payload));
}

export function PendingReportSaver() {
  const params = useSearchParams();
  const [pending, setPending] = useState<PendingSavedReport | null>(() => {
    if (params.get("savePending") !== "1") return null;

    const raw = localStorage.getItem(PENDING_REPORT_KEY);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as PendingSavedReport;
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
