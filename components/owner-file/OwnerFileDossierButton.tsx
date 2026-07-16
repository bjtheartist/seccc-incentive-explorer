"use client";

import { Download } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { generateOwnerFileDossierPdf } from "@/lib/owner-file-pdf";
import type { OwnerFile } from "@/lib/owner-file";

/** Client-side download button for the Owner File dossier PDF (lib/owner-file-pdf.ts, `.save()`). */
export function OwnerFileDossierButton({ ownerFile }: { ownerFile: OwnerFile }) {
  function download() {
    generateOwnerFileDossierPdf(ownerFile);
    trackEvent("owner_file_pdf_downloaded", {
      source: "owner_file_detail",
      metadata: {
        clusterKey: ownerFile.cluster.clusterKey,
        resolvedTier: ownerFile.resolvedTier,
      },
    });
  }

  return (
    <button
      onClick={download}
      className="inline-flex items-center gap-2 border border-[#0C1B33]/15 px-4 py-2.5 font-mono-bureau text-[11px] uppercase tracking-[0.14em] text-[#0C1B33]/70 hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
    >
      <Download className="h-3.5 w-3.5" /> Download Owner File PDF
    </button>
  );
}
