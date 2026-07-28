import { formatAsOf } from "./format";

/**
 * Methodology rail — the honesty footer every analysis carries. Lists the
 * underlying sources, the as-of date, and the caveats that keep the figures
 * honest. NEVER uses the word "received" as a data label: every dollar here is
 * an AWARDED amount from a public record, which is not proof of receipt.
 */
export function Methodology({ sources, generatedAt }: { sources: string[]; generatedAt: string }) {
  return (
    <div className="border border-[#0C1B33]/10 bg-[#0C1B33]/[0.02] p-6">
      <div className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#0C1B33]/45">
        Methodology &amp; caveats
      </div>

      <ul className="mt-4 space-y-2 text-[12px] leading-relaxed text-[#0C1B33]/55">
        <li>
          Dollars are <strong className="font-semibold text-[#0C1B33]/75">awarded</strong> amounts drawn from
          public records. An award is a commitment on paper — it does not confirm the money was received or
          spent.
        </li>
        <li>
          Foundation figures come from IRS 990 tax filings and carry a 1–2 year reporting lag, so the most
          recent grants are undercounted.
        </li>
        <li>
          Only grants sited to a point inside this community area are counted. Citywide and intermediary
          commitments — money that never lands in a single neighborhood — are excluded from community totals.
        </li>
        <li>
          Development projects are counted but not dollared: their figures are announced in prose (&ldquo;$7
          billion&rdquo;) that can&rsquo;t be reconciled to a single awarded amount.
        </li>
        <li>
          Community areas are assigned by point-in-polygon against the City&rsquo;s official Community Area
          boundaries.
        </li>
      </ul>

      <div className="mt-5 border-t border-[#0C1B33]/10 pt-4">
        <div className="font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/40">Sources</div>
        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-[#0C1B33]/45">
          {sources.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        <p className="mt-4 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/35">
          Data as of {formatAsOf(generatedAt)}
        </p>
      </div>
    </div>
  );
}
