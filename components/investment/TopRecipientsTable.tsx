import type { TopRecipient } from "@/lib/investment-analysis";
import { formatFullDollars, SOURCE_LABELS_SHORT, truncate } from "./format";
import { SaveRecordButton } from "./Shortlist";
import { RecordRowButton } from "./RecordDrawer";

/**
 * "Top recipients" — the biggest single awards in the community since 2020.
 * A plain table: rank, recipient, program, year, awarded dollars (right-aligned,
 * tabular), and a truncated log line. Dollars are AWARDED amounts, never
 * "received".
 *
 * When `saveEnabled` + `area` are supplied (the on-screen area page), each row
 * carries a client Save toggle that flags it into the localStorage working set
 * (Sol #3). When `drawerEnabled` (also the area page, wrapped in
 * <RecordDrawerProvider>), the recipient cell is a client button that opens the
 * full-record side drawer (Sol #1) — no navigation away. The print brief omits
 * both, so no interactive control reaches paper.
 */
export function TopRecipientsTable({
  recipients,
  saveEnabled = false,
  drawerEnabled = false,
  area,
}: {
  recipients: TopRecipient[];
  saveEnabled?: boolean;
  drawerEnabled?: boolean;
  area?: string;
}) {
  const showSave = saveEnabled && !!area;
  if (recipients.length === 0) {
    return (
      <div className="border border-[#0C1B33]/10 bg-white p-6 text-[13px] text-[#0C1B33]/55">
        No dated, dollar-valued awards to rank in this community since 2020.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[#0C1B33]/10 text-left text-[11px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
            <th className="px-4 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">Recipient</th>
            <th className="px-4 py-3 font-medium">Program</th>
            <th className="px-4 py-3 font-medium">Year</th>
            <th className="px-4 py-3 text-right font-medium">Awarded</th>
            <th className="px-4 py-3 font-medium">Project</th>
            {showSave ? <th className="px-4 py-3 text-right font-medium no-print">Save</th> : null}
          </tr>
        </thead>
        <tbody>
          {recipients.map((r, i) => (
            <tr key={`${r.id}-${i}`} className="border-b border-[#0C1B33]/5 align-top last:border-b-0">
              <td className="px-4 py-3 text-[#0C1B33]/40 [font-variant-numeric:tabular-nums]">{i + 1}</td>
              <td className="px-4 py-3 font-medium text-[#0C1B33]">
                {drawerEnabled ? (
                  <RecordRowButton record={r}>{r.recipient}</RecordRowButton>
                ) : (
                  r.recipient
                )}
              </td>
              <td className="px-4 py-3 text-[#0C1B33]/55">{SOURCE_LABELS_SHORT[r.source]}</td>
              <td className="px-4 py-3 text-[#0C1B33]/55 [font-variant-numeric:tabular-nums]">{r.year ?? "—"}</td>
              <td className="px-4 py-3 text-right font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
                {formatFullDollars(r.amountAwarded)}
              </td>
              <td className="px-4 py-3 text-[12px] leading-relaxed text-[#0C1B33]/50">
                {truncate(r.logLine, 96) || "—"}
              </td>
              {showSave ? (
                <td className="px-4 py-3 text-right no-print">
                  <SaveRecordButton
                    record={{
                      id: r.id,
                      recipient: r.recipient,
                      funderName: r.funderName,
                      source: r.source,
                      governmentFundingPurpose: r.governmentFundingPurpose,
                      year: r.year,
                      amountAwarded: r.amountAwarded,
                      communityArea: area as string,
                    }}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
