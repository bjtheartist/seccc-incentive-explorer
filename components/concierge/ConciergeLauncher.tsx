"use client";

import { Compass } from "lucide-react";

export function ConciergeLauncher({ openPanel }: { openPanel: () => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2 print:hidden sm:bottom-5 sm:right-5">
      <button
        type="button" onClick={openPanel} data-testid="concierge-help-prompt"
        className="border border-[#0C1B33]/15 bg-white px-3 py-2 text-[13px] font-medium leading-5 text-[#0C1B33] shadow-lg transition-colors hover:border-[#2563EB]/40 hover:text-[#2563EB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
      >I&apos;m here to help</button>
      <button
        type="button" onClick={openPanel} aria-label="Open Incentive Guide" title="Open Incentive Guide"
        className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-2 border-white bg-[#0C1B33] text-white shadow-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
      ><Compass className="h-5 w-5" strokeWidth={1.75} /></button>
    </div>
  );
}
