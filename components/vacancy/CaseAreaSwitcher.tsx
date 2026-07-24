"use client";

/**
 * The header "Area" card on the Case Workbench — a compact neighborhood
 * switcher styled as an editorial card (mock: "Area / South Chicago · 60617").
 * Selecting a neighborhood navigates to that ZIP's workbench root, dropping any
 * `?case=` param so the destination opens on its own default case. The native
 * <select> overlays the card so the whole card is the control (keyboard- and
 * screen-reader-accessible), while the card face shows the current area.
 */

import { useRouter } from "next/navigation";
import { PILOT_ZIPS } from "@/lib/pilot-zips";

export function CaseAreaSwitcher({ zip, neighborhood }: { zip: string; neighborhood: string }) {
  const router = useRouter();

  return (
    <div className="relative w-full border border-[#0C1B33]/15 bg-white px-4 py-3 sm:w-auto sm:min-w-[210px]">
      <span className="font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/45">
        Area
      </span>
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="font-editorial text-[19px] leading-tight text-[#0C1B33]">
          {neighborhood}
        </span>
        <span aria-hidden className="font-mono-bureau text-[11px] text-[#0C1B33]/40">
          ▾
        </span>
      </div>
      <span className="mt-0.5 block font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
        ZIP {zip}
      </span>
      <select
        aria-label="Area / neighborhood"
        value={zip}
        onChange={(event) => router.push(`/vacancy/${event.target.value}`)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {PILOT_ZIPS.map((entry) => (
          <option key={entry.zip} value={entry.zip}>
            {entry.primaryNeighborhood} · {entry.zip}
          </option>
        ))}
      </select>
    </div>
  );
}
