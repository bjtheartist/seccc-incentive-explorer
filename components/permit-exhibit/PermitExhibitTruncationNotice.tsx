import type { PermitExhibitTruncation } from "@/lib/permit-exhibit";
import { PERMIT_EXHIBIT_TRUNCATION_LABEL, permitExhibitTruncationScopeLine } from "@/lib/permit-exhibit-copy";

/**
 * The row-cap disclosure (R2 finding 8 follow-up).
 *
 * `buildPermitExhibit` has always COMPUTED `meta.truncation` — its own doc
 * comment says "every surface rendering it must say so" — but no surface
 * rendered it. A dense downtown PIN at 1000 ft that hit the 20,000-row cap
 * produced an exhibit with the same header, the same counts and the same
 * methods footer as a complete one, and the reader was told nothing. This is
 * the surface half of that contract.
 *
 * The sentence itself is the spine's (`truncation.notice`), never re-worded
 * here — one place per sentence, the same rule the S1/S3/S4 copy follows.
 * Only the label and the which-query line are rendering-layer copy.
 *
 * Renders nothing at all when `truncation` is null/undefined, which is the
 * ordinary case and a genuinely complete exhibit. `undefined` is reachable
 * on the saved-snapshot surfaces, whose stored documents predate the marker.
 */
export function PermitExhibitTruncationNotice({
  truncation,
  className = "",
}: {
  truncation: PermitExhibitTruncation | null | undefined;
  className?: string;
}) {
  if (!truncation) return null;

  return (
    <aside
      role="note"
      data-testid="permit-exhibit-truncation-notice"
      aria-label="Incomplete read"
      className={`border border-[#A45B00]/45 bg-[#A45B00]/[0.06] p-4 ${className}`.trim()}
    >
      <p className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.12em] text-[#A45B00]">
        {PERMIT_EXHIBIT_TRUNCATION_LABEL}
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-[#0C1B33]/75">{truncation.notice}</p>
      <p className="mt-2 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
        {permitExhibitTruncationScopeLine(truncation.scope, truncation.rowCap)}
      </p>
    </aside>
  );
}
