"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { buildVacancyIndexPdfInput } from "@/lib/vacancy-index-adapter";
import { generateVacancyIndexPdf } from "@/lib/vacancy-index-pdf";
import type { VacancyIndexExport } from "@/lib/vacancy-index";

/**
 * Gated download button for the shareable Vacancy Opportunity Index edition.
 * Fetches the static export on click (keeps the force-dynamic admin page's
 * RSC payload lean); the PDF itself is anonymized and safe to share onward.
 */
export function VacancyIndexPdfButton({
  zip,
  neighborhood,
  source,
}: {
  zip: string;
  neighborhood: string;
  source: "owner_files_zip" | "owner_files_landing" | "vacancy_web_report";
}) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");

  async function download() {
    setState("working");
    try {
      const res = await fetch("/data/vacancy-index.json");
      if (!res.ok) throw new Error(`vacancy-index.json ${res.status}`);
      const exportData = (await res.json()) as VacancyIndexExport;
      const input = buildVacancyIndexPdfInput(exportData, zip);
      if (!input) throw new Error(`no edition for ${zip}`);
      generateVacancyIndexPdf(input);
      trackEvent("vacancy_index_pdf_downloaded", {
        source,
        metadata: {
          zip,
          siteCount: exportData.editions[zip]?.sitePoints.length ?? 0,
          truncated: exportData.editions[zip]?.sitePointsTruncated ?? false,
        },
      });
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <button
      onClick={download}
      disabled={state === "working"}
      className="inline-flex items-center gap-2 border border-[#0C1B33]/15 px-4 py-2.5 font-mono-bureau text-[11px] uppercase tracking-[0.14em] text-[#0C1B33]/70 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] disabled:opacity-50"
    >
      <Download className="h-3.5 w-3.5" />
      {state === "working"
        ? "Preparing…"
        : state === "error"
          ? "Download failed — retry"
          : `${neighborhood} Vacancy Index PDF`}
    </button>
  );
}
