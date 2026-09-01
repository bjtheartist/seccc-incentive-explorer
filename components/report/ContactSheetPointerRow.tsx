"use client";

// ─── Who-to-call pointer row (owner ruling, Billy 2026-08-31) ────────────
// SUPPORTER lens only. A supporter's job is routing, so PART 02 ends by
// naming, in one line, how many partners this very report already carries
// and pointing at them in PART 03.
//
// Its own module rather than a second export from ContactSheet.tsx so both
// ReportDisplay forks can keep the exact single-symbol
// `import { ContactSheet }` line the fork-parity guard in
// lib/__tests__/refine-tier1.test.ts pins.
//
// No new data and no reordering of the guidepost parts: the count is
// `buildContactSheetRows` — literally the rows the Contact Sheet in PART 03
// will render for this report and this persona, read off the SAME lensed
// report that component reads — and the row renders nothing at all when
// that count is zero.

import { buildContactSheetRows } from "@/lib/report-contact-sheet";
import type { GeneratedReport } from "@/lib/report-engine";
import type { PersonaId } from "@/lib/personas";
import { CONTACT_SHEET_ANCHOR } from "@/components/report/ContactSheet";

export function ContactSheetPointerRow({
  report: lensed,
  persona,
}: {
  /** The already-lensed report — the SAME input ContactSheet itself reads. */
  report: GeneratedReport;
  persona: PersonaId;
}) {
  const count = buildContactSheetRows(lensed, persona).length;
  if (count === 0) return null;
  return (
    <a
      data-testid="contact-sheet-pointer"
      data-contact-count={count}
      href={`#${CONTACT_SHEET_ANCHOR}`}
      className="my-3 flex items-center justify-between gap-3 border border-[#D8DDE6] bg-white px-3.5 py-2.5 text-[12.5px] text-[#0C1B33] transition-colors hover:border-[#2563EB]"
    >
      <span>
        {count} partner{count === 1 ? "" : "s"} can help you route{" "}
        {count === 1 ? "this" : "these"} — see the Contact Sheet
      </span>
      <span className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#2563EB]">
        Part 03
      </span>
    </a>
  );
}
