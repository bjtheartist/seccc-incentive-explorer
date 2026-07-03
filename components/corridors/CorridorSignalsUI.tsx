/**
 * Shared presentational pieces for the unlisted "Corridor Signals" preview
 * report (app/corridors, app/corridors/[zip]). Server-safe (no client
 * interactivity) and styled with the same Bureau design tokens used by the
 * rest of the report surface (font-editorial / font-mono-bureau / bg-warm /
 * accent-bar — see app/globals.css and app/neighborhoods/[slug]/incentives).
 *
 * This is a standalone, unlisted test feature — see the copy-doctrine notes
 * inline on each row for why fields are rendered the way they are.
 */

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#2563EB]">
      {children}
    </span>
  );
}

/**
 * Preview / test-dataset banner. Required on both /corridors and
 * /corridors/[zip] per the "unlisted, experimental" framing — this is NOT
 * part of the standard report and must never be confused for one.
 */
export function CorridorPreviewBanner() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4">
      <p className="font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-amber-700">
        Corridor Signals (Preview)
      </p>
      <p className="text-[13px] text-[#0C1B33]/70 mt-1.5 leading-relaxed">
        Experimental citywide dataset — not part of the standard report. Figures
        here come from a batch export that is still being validated and may be
        incomplete or change without notice. This page is unlisted: it is not
        linked from the site and is not included in search indexing.
      </p>
    </div>
  );
}

/** A single labeled row inside a data card — value + detail text. */
export function DataRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-[#0C1B33]/10 bg-white p-5">
      <p className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/50">
        {label}
      </p>
      <p className="font-editorial text-xl md:text-2xl text-[#0C1B33] mt-2">
        {value}
      </p>
      <p className="text-[13px] text-[#0C1B33]/55 mt-2 leading-relaxed">
        {detail}
      </p>
    </div>
  );
}

/** "Data pending" placeholder — never renders a bare 0%/0 when data is absent. */
export function DataPendingRow({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#0C1B33]/15 bg-white/60 p-5">
      <p className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/40">
        {label}
      </p>
      <p className="text-[13px] text-[#0C1B33]/45 mt-2 leading-relaxed">
        Data pending — this source hasn&apos;t loaded for this ZIP yet.
      </p>
    </div>
  );
}

/**
 * "How to read this" footnote, adapted from the equivalent block in
 * lib/report-engine.ts (buildNeighborhoodEconomicContext, ~line 1316-1321)
 * so the framing language matches the rest of the product.
 */
export function ContextNotProofFootnote() {
  return (
    <div className="rounded-xl border border-[#0C1B33]/10 bg-[#EFF3FB] p-5">
      <p className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/55">
        How to read this — Context, not proof
      </p>
      <p className="text-[13px] text-[#0C1B33]/60 mt-2 leading-relaxed">
        These figures are ZIP-level aggregates for context — not address-level
        proof. Vacancy, license activity, and ownership rows describe
        public-record patterns across this ZIP; they are a neighborhood
        signal, not a judgment of the community or its residents. Reported
        permit cost is self-reported on permit applications and should be
        treated as directional. Verify any specific address or parcel before
        making a decision.
      </p>
    </div>
  );
}

export function usdShort(value?: number | null): string | null {
  if (value == null || Number.isNaN(Number(value))) return null;
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}
