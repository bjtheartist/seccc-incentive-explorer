import { formatAsOf, formatFullDollars } from "./format";

/** The dedupe ledger summary (meta.dedupeCandidateGroups etc — deliverable 3 /
 * audit finding 4 / consult F4 + Q1). Optional so a caller without a loaded
 * export still renders the rest of the rail. */
export interface MethodologyDedupeStats {
  candidateGroups: number;
  collapsedRows: number;
  collapsedDollars: number;
  keptFlaggedGroups: number;
  keptFlaggedRows: number;
}

/**
 * Methodology rail — the honesty footer every analysis carries. Lists the
 * underlying sources, the as-of date, and the caveats that keep the figures
 * honest. NEVER uses the word "received" as a data label: every dollar here is
 * an AWARDED amount from a public record, which is not proof of receipt.
 */
export function Methodology({
  sources,
  generatedAt,
  dedupe,
}: {
  sources: string[];
  generatedAt: string;
  /** Reads meta.dedupeCandidateGroups / dedupeCollapsedRows / dedupeCollapsedDollars
   * / dedupeKeptFlaggedGroups / dedupeKeptFlaggedRows (PR1 guarantees these exist)
   * — never a hand-typed count. Omitted entirely when the caller has none. */
  dedupe?: MethodologyDedupeStats;
}) {
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
          Development projects are counted; development capital is reported separately as announced capital
          and excluded from awarded totals.
        </li>
        <li>
          Community areas are assigned by point-in-polygon against the City&rsquo;s official Community Area
          boundaries.
        </li>
        {dedupe && dedupe.candidateGroups > 0 ? (
          <li>
            A source-keyed duplicate scan found {dedupe.candidateGroups.toLocaleString("en-US")} indistinguishable
            group{dedupe.candidateGroups === 1 ? "" : "s"} among foundation rows.{" "}
            {dedupe.collapsedRows > 0 ? (
              <>
                {dedupe.collapsedRows.toLocaleString("en-US")} row{dedupe.collapsedRows === 1 ? "" : "s"} (
                {formatFullDollars(dedupe.collapsedDollars)}) were confirmed duplicates by the filing itself and
                collapsed.{" "}
              </>
            ) : null}
            {dedupe.keptFlaggedRows > 0 ? (
              <>
                {dedupe.keptFlaggedRows.toLocaleString("en-US")} row{dedupe.keptFlaggedRows === 1 ? "" : "s"} across{" "}
                {dedupe.keptFlaggedGroups.toLocaleString("en-US")} group
                {dedupe.keptFlaggedGroups === 1 ? "" : "s"} were kept and flagged — &ldquo;Two source line items;
                award-level distinctness not independently verified&rdquo; — because identical funder, recipient,
                address, amount, purpose, and tax year alone does not prove a duplicate.
              </>
            ) : null}
          </li>
        ) : null}
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
