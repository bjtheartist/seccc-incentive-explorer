import type { CapitalContextForArea } from "@/lib/investment-analysis";
import { formatCompactDollars, formatCount, formatFullDollars } from "./format";

/**
 * Capital-class context for the print brief's second page — the coordinate-less
 * capital that sits BESIDE the plotted awarded grants, never summed with them:
 *   • TIF authorized / federal program / tax-credit capital sited in this
 *     community (from its point-stamped records — analysis totals).
 *   • FFIEC CRA small-business lending series (community-area keyed).
 *   • CDFI transaction series (community-area geography level).
 * Each is a DIFFERENT money concept (a ceiling, an allocation, bank loans, CDFI
 * loans/investments) — shown as its own small series so a reader can weigh them
 * without ever adding them together. A missing series says so plainly.
 */
export function CapitalContext({
  context,
  authorizedTif,
  federalProgram,
  creditCapital,
}: {
  context: CapitalContextForArea;
  authorizedTif: number;
  federalProgram: number;
  creditCapital: number;
}) {
  return (
    <div className="brief-figure border border-[#0C1B33]/10 bg-white p-5">
      <p className="text-[12px] leading-relaxed text-[#0C1B33]/55">
        The measures below are DIFFERENT money concepts from the awarded grants elsewhere in this brief —
        authorized ceilings, committed allocations, tax-credit capital, bank small-business loans, and CDFI
        activity. They are shown side by side and are never added together.
      </p>

      {/* CA-sited non-grant capital classes (from point-stamped records). */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <div className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">TIF authorized</div>
          <div className="mt-0.5 text-[15px] font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
            {authorizedTif > 0 ? formatCompactDollars(authorizedTif) : "None on record"}
          </div>
        </div>
        <div>
          <div className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">Federal (CDBG/HOME)</div>
          <div className="mt-0.5 text-[15px] font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
            {federalProgram > 0 ? formatCompactDollars(federalProgram) : "None on record"}
          </div>
        </div>
        <div>
          <div className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">Tax credit (LIHTC/NMTC)</div>
          <div className="mt-0.5 text-[15px] font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
            {creditCapital > 0 ? formatCompactDollars(creditCapital) : "None on record"}
          </div>
        </div>
      </div>

      {/* CRA small-business lending (community-area keyed). */}
      <div className="mt-5">
        <div className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
          Bank small-business lending (FFIEC CRA)
        </div>
        {context.cra ? (
          <table className="mt-1.5 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-[#0C1B33]/10 text-left text-[#0C1B33]/45">
                <th className="py-1 pr-3 font-medium">Year</th>
                <th className="py-1 pr-3 text-right font-medium">Loans</th>
                <th className="py-1 text-right font-medium">Dollars</th>
              </tr>
            </thead>
            <tbody>
              {context.cra.map((r) => (
                <tr key={r.year} className="border-b border-[#0C1B33]/5 last:border-b-0">
                  <td className="py-1 pr-3 text-[#0C1B33]/70 [font-variant-numeric:tabular-nums]">{r.year}</td>
                  <td className="py-1 pr-3 text-right text-[#0C1B33]/70 [font-variant-numeric:tabular-nums]">
                    {formatCount(r.smallBusinessLoanCount)}
                  </td>
                  <td className="py-1 text-right text-[#0C1B33]/70 [font-variant-numeric:tabular-nums]">
                    {formatFullDollars(r.smallBusinessLoanDollars)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-1 text-[11px] text-[#0C1B33]/45">No CRA small-business series for this community area.</p>
        )}
      </div>

      {/* CDFI activity (community-area geography level). */}
      <div className="mt-4">
        <div className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
          CDFI loans &amp; investments
        </div>
        {context.cdfi ? (
          <table className="mt-1.5 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-[#0C1B33]/10 text-left text-[#0C1B33]/45">
                <th className="py-1 pr-3 font-medium">Year</th>
                <th className="py-1 pr-3 text-right font-medium">Transactions</th>
                <th className="py-1 text-right font-medium">Dollars</th>
              </tr>
            </thead>
            <tbody>
              {context.cdfi.map((r) => (
                <tr key={r.year} className="border-b border-[#0C1B33]/5 last:border-b-0">
                  <td className="py-1 pr-3 text-[#0C1B33]/70 [font-variant-numeric:tabular-nums]">{r.year}</td>
                  <td className="py-1 pr-3 text-right text-[#0C1B33]/70 [font-variant-numeric:tabular-nums]">
                    {formatCount(r.transactionCount)}
                  </td>
                  <td className="py-1 text-right text-[#0C1B33]/70 [font-variant-numeric:tabular-nums]">
                    {formatFullDollars(r.dollars)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-1 text-[11px] text-[#0C1B33]/45">No CDFI series for this community area.</p>
        )}
      </div>
    </div>
  );
}
