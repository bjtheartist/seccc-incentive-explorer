"use client";

import { useMemo, useState } from "react";
import type { FlowRow } from "@/lib/investment-analysis";
import { FUNDER_TYPE_COLORS } from "@/lib/community-investment-layer";
import type { FunderType } from "@/lib/community-investment";
import {
  GOVERNMENT_FUNDING_PURPOSES,
  GOVERNMENT_FUNDING_PURPOSE_LABELS,
  type GovernmentFundingPurpose,
} from "@/lib/government-funding-purpose";
import { formatFullDollars, formatPercent, SOURCE_LABELS_SHORT } from "./format";

/**
 * The DEFAULT reading of "How the money flowed" (Sol #4): a searchable
 * funder → program → recipient table, sorted by awarded dollars, with each row's
 * share of the community total. Tables filter and scan far better than a Sankey
 * for a working session; the Sankey moves behind an "Explore funding paths"
 * disclosure for the visual gestalt once the reader knows what they're looking at.
 *
 * Client component: one text box filters across funder, program, and recipient.
 * Every figure is an AWARDED amount. Pure presentation over server-shaped rows.
 */
/** Rows actually rendered into the DOM. The search filters over EVERY flow, so
 * nothing is unfindable — but a 4,000-row community (the flows tripled when the
 * foundation universe reached the 80% coverage bar) must not mount 4,000 table
 * rows. Rows are already sorted by dollars desc, so the cap keeps the head. */
const RENDER_CAP = 400;

export function FunderFlowTable({ rows, total }: { rows: FlowRow[]; total: number }) {
  const [query, setQuery] = useState("");
  const [purpose, setPurpose] = useState<"all" | GovernmentFundingPurpose>("all");

  /** The purposes that actually occur in these rows, in the canonical order.
   * Derived, never hardcoded: a purpose only reaches this table if some record
   * carries it AND a positive awarded amount, and buildFlowRows drops null-amount
   * records. Today every `programmatic` and `unclassified` government record is a
   * null-amount capital class (NMTC tax credits, CDBG/HOME federal allocations,
   * state relief programs), so a fixed <option> for those offered a filter that
   * could never match — an empty table reading as a contradiction of the non-zero
   * purpose counts one section up. Deriving also means a future export that does
   * publish such an award gets its filter back with no edit here. */
  const availablePurposes = useMemo(() => {
    const present = new Set(rows.map((r) => r.governmentFundingPurpose));
    return GOVERNMENT_FUNDING_PURPOSES.filter((p) => present.has(p));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (purpose !== "all" && r.governmentFundingPurpose !== purpose) return false;
      if (!q) return true;
      const purposeLabel = r.governmentFundingPurpose
        ? GOVERNMENT_FUNDING_PURPOSE_LABELS[r.governmentFundingPurpose]
        : "Not government";
      return (
        r.funderName.toLowerCase().includes(q) ||
        r.recipient.toLowerCase().includes(q) ||
        (SOURCE_LABELS_SHORT[r.source] ?? r.source).toLowerCase().includes(q) ||
        purposeLabel.toLowerCase().includes(q) ||
        String(r.year).includes(q)
      );
    });
  }, [purpose, rows, query]);
  const rendered = filtered.length > RENDER_CAP ? filtered.slice(0, RENDER_CAP) : filtered;

  if (rows.length === 0) {
    return (
      <div className="border border-[#0C1B33]/10 bg-white p-6 text-[13px] text-[#0C1B33]/55">
        No dollar-valued flows to list here since 2020. Development projects and undated grants carry no awarded
        amount and are not shown.
      </div>
    );
  }

  return (
    <div className="border border-[#0C1B33]/10 bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#0C1B33]/10 px-4 py-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search funder, program, or recipient…"
          className="w-full max-w-xs rounded-[3px] border border-[#0C1B33]/15 bg-white px-3 py-1.5 text-[13px] text-[#0C1B33] placeholder:text-[#0C1B33]/35 focus:border-[#2563EB] focus:outline-none"
        />
        {availablePurposes.length > 0 ? (
          <label className="w-full sm:w-52">
            <span className="block font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
              Government funding purpose
            </span>
            <select
              value={purpose}
              onChange={(event) =>
                setPurpose(event.target.value as "all" | GovernmentFundingPurpose)
              }
              className="mt-1 h-8 w-full rounded-[3px] border border-[#0C1B33]/15 bg-white px-2 text-[12px] text-[#0C1B33]/70 outline-none focus:border-[#2563EB]"
            >
              <option value="all">All funding purposes</option>
              {availablePurposes.map((p) => (
                <option key={p} value={p}>
                  {GOVERNMENT_FUNDING_PURPOSE_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
          {filtered.length} of {rows.length} flow{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="max-h-[440px] overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[#0C1B33]/10 text-left text-[11px] uppercase tracking-[0.08em] text-[#0C1B33]/45">
              <th className="px-4 py-2.5 font-medium">Funder</th>
              <th className="px-4 py-2.5 font-medium">Program</th>
              <th className="px-4 py-2.5 font-medium">Funding purpose</th>
              <th className="px-4 py-2.5 font-medium">Recipient</th>
              <th className="px-4 py-2.5 font-medium">Year</th>
              <th className="px-4 py-2.5 text-right font-medium">Awarded</th>
              <th className="px-4 py-2.5 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {rendered.map((r) => (
              <tr key={r.id} className="border-b border-[#0C1B33]/5 last:border-b-0">
                <td className="px-4 py-2.5 text-[#0C1B33]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: FUNDER_TYPE_COLORS[r.funderType as FunderType] ?? "#9CA3AF" }}
                    />
                    <span className="font-medium">{r.funderName}</span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-[#0C1B33]/55">{SOURCE_LABELS_SHORT[r.source] ?? r.source}</td>
                <td className="px-4 py-2.5 text-[#0C1B33]/55">
                  {r.governmentFundingPurpose
                    ? GOVERNMENT_FUNDING_PURPOSE_LABELS[r.governmentFundingPurpose]
                    : "Not government"}
                </td>
                <td className="px-4 py-2.5 text-[#0C1B33]/80">{r.recipient}</td>
                <td className="px-4 py-2.5 text-[#0C1B33]/55 [font-variant-numeric:tabular-nums]">{r.year}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
                  {formatFullDollars(r.amountAwarded)}
                </td>
                <td className="px-4 py-2.5 text-right text-[#0C1B33]/45 [font-variant-numeric:tabular-nums]">
                  {total > 0 ? formatPercent(r.amountAwarded / total, 1) : "—"}
                </td>
              </tr>
            ))}
            {filtered.length > RENDER_CAP ? (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-center text-[12px] text-[#0C1B33]/50">
                  Showing the {RENDER_CAP} largest of {filtered.length.toLocaleString()} flows — search
                  covers all of them; narrow to see the rest.
                </td>
              </tr>
            ) : null}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[13px] text-[#0C1B33]/45">
                  No awarded flows match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
