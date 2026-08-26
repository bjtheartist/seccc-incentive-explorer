import { formatFullDollars } from "@/components/investment/format";
import { formatPermitAreaDate } from "@/lib/permit-area";
import { PERMIT_EXHIBIT_COST_LABEL, type PermitExhibitArea, type PermitExhibitAreaRow } from "@/lib/permit-exhibit";
import { permitExhibitAddressOnlyNote } from "@/lib/permit-exhibit-copy";

function chronological(rows: PermitExhibitAreaRow[]): PermitExhibitAreaRow[] {
  return [...rows].sort((a, b) => (a.issueDate ?? "").localeCompare(b.issueDate ?? ""));
}

function CountBars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div>
      <p className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0C1B33]/60">
        {title}
      </p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-[11px] text-[#0C1B33]/65" title={row.label}>
              {row.label}
            </span>
            <span className="h-2.5 flex-1 bg-[#0C1B33]/6">
              <span
                className="block h-full bg-[#2563EB]/70"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-[#0C1B33]/70">
              {row.count.toLocaleString("en-US")}
            </span>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="text-[12px] text-[#0C1B33]/45">No records in this radius.</li>
        ) : null}
      </ul>
    </div>
  );
}

function AreaRecordRow({ row }: { row: PermitExhibitAreaRow }) {
  return (
    <tr className="border-b border-[#0C1B33]/6 last:border-b-0">
      <td className="px-2.5 py-2 text-[12px] text-[#0C1B33]/70 [font-variant-numeric:tabular-nums]">
        {formatPermitAreaDate(row.issueDate)}
      </td>
      <td className="px-2.5 py-2 text-[12px] font-medium text-[#0C1B33]">
        {row.sourceRecordUrl ? (
          <a href={row.sourceRecordUrl} target="_blank" rel="noreferrer" className="hover:text-[#2563EB] hover:underline">
            {row.permitNumber}
          </a>
        ) : (
          row.permitNumber
        )}
      </td>
      <td className="px-2.5 py-2 text-[12px] text-[#0C1B33]/70">{row.type}</td>
      <td className="min-w-[18rem] max-w-[30rem] whitespace-normal break-words px-2.5 py-2 text-[12px] leading-relaxed text-[#0C1B33]/55">
        {row.workDescription ?? <span className="italic text-[#0C1B33]/40">Not published by City</span>}
      </td>
      <td className="px-2.5 py-2 text-right text-[12px] font-medium text-[#0C1B33] [font-variant-numeric:tabular-nums]">
        {formatFullDollars(row.estimatedCostSelfReported)}
      </td>
      <td className="px-2.5 py-2 text-[12px] text-[#0C1B33]/55">{row.status ?? "Not recorded"}</td>
    </tr>
  );
}

function AreaRecordTable({ rows, caption }: { rows: PermitExhibitAreaRow[]; caption: string }) {
  return (
    <div className="overflow-x-auto border border-[#0C1B33]/10 bg-white">
      <table className="w-full min-w-[900px] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[#0C1B33]/10 text-left font-mono-bureau text-[9px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
            <th className="px-2.5 py-2 font-medium">Issue date</th>
            <th className="px-2.5 py-2 font-medium">Permit #</th>
            <th className="px-2.5 py-2 font-medium">Type</th>
            <th className="px-2.5 py-2 font-medium">Work description</th>
            <th className="px-2.5 py-2 text-right font-medium">{PERMIT_EXHIBIT_COST_LABEL}</th>
            <th className="px-2.5 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <AreaRecordRow key={row.permitNumber} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * S2 — area context: permits within the chosen radius, aggregated by year
 * and by type (counts only — no cost aggregation anywhere, per the spec's
 * pinned rule), plus the individual records. Rows located only via a
 * sibling address match (`locatedVia === "address_only"` — the row's own
 * point was never confirmed inside the radius) are disclosed in their own
 * subsection rather than mixed into the point-located table, the same
 * separation discipline S1 applies to proximity rows.
 */
export function AreaContextSection({ area, radiusFt }: { area: PermitExhibitArea; radiusFt: number }) {
  const pointRows = chronological(area.rows.filter((row) => row.locatedVia === "point"));
  const addressOnlyRows = chronological(area.rows.filter((row) => row.locatedVia === "address_only"));
  const radiusLabel = `${radiusFt.toLocaleString("en-US")} ft`;

  return (
    <section className="mt-8" aria-labelledby="s2-area-title">
      <p className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#2563EB]">S2 · Area context</p>
      <h2 id="s2-area-title" className="mt-1 font-editorial text-[24px] leading-tight text-[#0C1B33]">
        Permits within {radiusLabel}
      </h2>
      <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/55">
        Pattern evidence only — what has been permitted nearby over the tracked window. Counts below are
        never a proxy for cost; no dollar figure is aggregated at this level.
      </p>

      <div className="mt-4 grid gap-6 border border-[#0C1B33]/10 bg-white p-4 sm:grid-cols-2">
        <CountBars
          title="By year"
          rows={area.byYear.map((row) => ({ label: String(row.year), count: row.count }))}
        />
        <CountBars title="By type" rows={area.byType.map((row) => ({ label: row.label, count: row.count }))} />
      </div>

      <div className="mt-5">
        <p className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
          {pointRows.length.toLocaleString("en-US")} located-by-point {pointRows.length === 1 ? "record" : "records"}
        </p>
        {pointRows.length > 0 ? (
          <div className="mt-2">
            <AreaRecordTable rows={pointRows} caption="Radius permits located by geocoded point." />
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-[#0C1B33]/45">No point-located records in this radius.</p>
        )}
      </div>

      {addressOnlyRows.length > 0 ? (
        <div className="mt-5 border border-[#0C1B33]/15 bg-[#0C1B33]/[0.02] p-4" data-testid="area-address-only-subsection">
          <p className="font-mono-bureau text-[10px] font-semibold uppercase tracking-[0.1em] text-[#0C1B33]/60">
            Matched by address only — not confirmed by map location
          </p>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[#0C1B33]/55">
            {permitExhibitAddressOnlyNote(radiusLabel)}
          </p>
          <div className="mt-3">
            <AreaRecordTable rows={addressOnlyRows} caption="Radius permits matched by address only." />
          </div>
        </div>
      ) : null}
    </section>
  );
}
