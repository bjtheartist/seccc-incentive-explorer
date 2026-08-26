"use client";

import { Printer } from "lucide-react";

export function PermitExhibitPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 w-full items-center justify-center border border-[#0C1B33] bg-[#0C1B33] px-4 py-2 font-mono-bureau text-[10px] font-medium uppercase tracking-[0.09em] text-white transition-colors hover:border-[#2563EB] hover:bg-[#2563EB]"
    >
      <Printer aria-hidden className="mr-2 h-3.5 w-3.5" strokeWidth={1.8} />
      Print / Save PDF
    </button>
  );
}
