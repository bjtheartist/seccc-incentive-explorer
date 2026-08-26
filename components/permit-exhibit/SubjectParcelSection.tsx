import { formatFullDollars } from "@/components/investment/format";
import { formatPermitAreaDate } from "@/lib/permit-area";
import {
  PERMIT_EXHIBIT_COST_LABEL,
  PERMIT_EXHIBIT_PROXIMITY_HEADING,
  PERMIT_EXHIBIT_PROXIMITY_NOTE,
  permitExhibitCityRecordUrl,
} from "@/lib/permit-exhibit-copy";
import type { PermitExhibitRow } from "@/lib/permit-exhibit-types";

const MATCH_METHOD_LABEL: Record<PermitExhibitRow["matchMethod"], string> = {
  pin_parcel: "Parcel match",
  address_exact: "Address match",
  proximity: "Proximity only",
};

function chronological(rows: PermitExhibitRow[]): PermitExhibitRow[] {
  return [...rows].sort((a, b) => a.issueDate.localeCompare(b.issueDate));
}

function MethodTag({ method }: { method: PermitExhibitRow["matchMethod"] }) {
  const tone =
    method === "pin_parcel"
      ? "border-[#2563EB]/30 bg-[#2563EB]/8 text-[#2563EB]"
      : method === "address_exact"
        ? "border-[#0C1B33]/25 bg-[#0C1B33]/5 text-[#0C1B33]/75"
        : "border-[#A45B00]/35 bg-[#A45B00]/8 text-[#A45B00]";
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 font-mono-bureau text-[9px] uppercase tracking-[0.08em] ${tone}`}
      data-testid="match-method-tag"
      data-match-method={method}
    >
      {MATCH_METHOD_LABEL[method]}
    </span>
  );
}

function RecordRow({ row }: { row: PermitExhibitRow }) {
  const recordUrl = permitExhibitCityRecordUrl(row.permitNumber);
  return (
    <tr className="border-b border-[#0C1B33]/6 last:border-b-0">
      <td className="px-2.5 py-2 text-[12px] text-[#0C1B33]/70 [font-variant-numeric:tabular-nums]">
        {formatPermitAreaDate(row.issueDate)}
      </td>
      <td className="px-2.5 py-2 text-[12px] font-medium text-[#0C1B33]">
        {recordUrl ? (
          <a href={recordUrl} target="_blank" rel="noreferrer" className="hover:text-[#2563EB] hover:underline">
            {row.permitNumber}
          </a>
        ) : (
          row.permitNumber
        )}
      </td>
      <td className="px-2.5 py-2 text-[12px] text-[#0C1B33]/70">{row.type}</td>
      <td className="px-2.5 py-2 text-[12px] text-[#0C1B33]/55">{row.workDescription ?? "Not recorded"}</td>
      <td className="px-2.5 py-2 text-right text-[12px] font-medium text-[#0C1B33] [font-variant-numeric:tabular-nums]">
        {formatFullDollars(row.estimatedCostSelfReported)}
      </td>
      <td className="px-2.5 py-2 text-[12px] text-[#0C1B33]/55">{row.status ?? "Not recorded"}</td>
      <td className="px-2.5 py-2">
        <MethodTag method={row.matchMethod} />
      </td>
    </tr>
  );
}

function RecordTable({ rows, caption }: { rows: PermitExhibitRow[]; caption: string }) {
  return (
    <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
      <table className="w-full min-w-[820px] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[#0C1B33]/10 text-left font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
            <th className="px-2.5 py-2 font-medium">Issue date</th>
            <th className="px-2.5 py-2 font-medium">Permit #</th>
            <th className="px-2.5 py-2 font-medium">Type</th>
            <th className="px-2.5 py-2 font-medium">Work description</th>
            <th className="px-2.5 py-2 text-right font-medium">{PERMIT_EXHIBIT_COST_LABEL}</th>
            <th className="px-2.5 py-2 font-medium">Status</th>
            <th className="px-2.5 py-2 font-medium">Match method</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <RecordRow key={row.permitNumber} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * S1 — subject parcel record. The one hard rule the spec pins here: a
 * `proximity` row must NEVER present as a parcel match, so it is rendered
 * in its own visually distinct subsection ("Nearby, not matched to this
 * parcel") — never intermingled with the pin_parcel/address_exact main
 * table. See components/permit-exhibit/__tests__/subject-parcel-section.test.tsx
 * for the pinned separation assertion.
 */
export function SubjectParcelSection({ subject }: { subject: PermitExhibitRow[] }) {
  const mainRows = chronological(subject.filter((row) => row.matchMethod !== "proximity"));
  const proximityRows = chronological(subject.filter((row) => row.matchMethod === "proximity"));

  return (
    <section className="mt-8" aria-labelledby="s1-subject-title">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#2563EB]">S1 · Subject parcel record</p>
          <h2 id="s1-subject-title" className="mt-1 font-editorial text-[24px] leading-tight text-[#0C1B33]">
            Every permit linked to this parcel
          </h2>
        </div>
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
          {mainRows.length.toLocaleString("en-US")} {mainRows.length === 1 ? "record" : "records"}
        </span>
      </div>

      {mainRows.length > 0 ? (
        <div className="mt-4">
          <RecordTable rows={mainRows} caption="Permits matched to this parcel, oldest first." />
        </div>
      ) : (
        <p className="mt-4 border border-dashed border-[#0C1B33]/20 bg-[#FAF9F6] p-4 text-[13px] leading-relaxed text-[#0C1B33]/55">
          No permits matched this parcel by PIN or by its situs address. This is a recorded zero, not
          an unavailable lookup — see the nearby permits below and the coverage note in Methods &amp;
          limits.
        </p>
      )}

      {proximityRows.length > 0 ? (
        <div className="mt-5 border border-[#A45B00]/30 bg-[#A45B00]/[0.04] p-4" data-testid="proximity-subsection">
          <p className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.1em] text-[#A45B00]">
            {PERMIT_EXHIBIT_PROXIMITY_HEADING}
          </p>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/60">
            {PERMIT_EXHIBIT_PROXIMITY_NOTE}
          </p>
          <div className="mt-3">
            <RecordTable
              rows={proximityRows}
              caption="Permits near this parcel by coordinate proximity, not matched to it by PIN or address."
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
