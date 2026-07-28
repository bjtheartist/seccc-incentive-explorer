"use client";

import { useSyncExternalStore } from "react";
import {
  type ShortlistRecord,
  clearInvestmentWorkingSet,
  downloadCsv,
  getShortlistServerSnapshot,
  getShortlistSnapshot,
  removeShortlistRecord,
  setShortlistNote,
  shortlistToCsv,
  subscribeShortlist,
  toggleShortlistRecord,
} from "./local-store";
import { formatFullDollars, SOURCE_LABELS_SHORT } from "./format";
import type { InvestmentSource } from "@/lib/community-investment";

/**
 * The saved working set (Sol #3): flag records off the Top-recipients table into
 * a localStorage shortlist, annotate each with a meeting note, and export the
 * exact selection as CSV — all client-side, no server round-trip. Admin-side (the
 * tree is gated). SaveRecordButton toggles membership; WorkingSetPanel is the
 * editor + exporter. They stay in sync through the SHORTLIST_EVENT bus.
 */

/** The live shortlist from the localStorage store (hydration-safe, effect-free). */
function useShortlist(): ShortlistRecord[] {
  return useSyncExternalStore(subscribeShortlist, getShortlistSnapshot, getShortlistServerSnapshot);
}

/** A compact flag/unflag toggle rendered per Top-recipients row. */
export function SaveRecordButton({ record }: { record: Omit<ShortlistRecord, "notes"> }) {
  const shortlist = useShortlist();
  const saved = shortlist.some((r) => r.id === record.id);

  return (
    <button
      type="button"
      onClick={() => toggleShortlistRecord(record)}
      aria-pressed={saved}
      title={saved ? "Remove from working set" : "Save to working set"}
      className={`inline-flex items-center gap-1 rounded-[2px] border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] transition-colors ${
        saved
          ? "border-[#2563EB] bg-[#2563EB]/[0.08] text-[#2563EB]"
          : "border-[#0C1B33]/15 bg-white text-[#0C1B33]/55 hover:border-[#0C1B33]/30 hover:text-[#0C1B33]"
      }`}
    >
      <span aria-hidden>{saved ? "★" : "☆"}</span>
      {saved ? "Saved" : "Save"}
    </button>
  );
}

/** The working-set editor: saved records, per-record notes, CSV export, clear. */
export function WorkingSetPanel() {
  const items = useShortlist();

  return (
    <div className="no-print border border-[#0C1B33]/10 bg-[#0C1B33]/[0.02] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#0C1B33]/45">
          Working set · {items.length} saved
        </div>
        {items.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadCsv("investment-working-set.csv", shortlistToCsv(items))}
              className="rounded-[3px] border border-[#2563EB] bg-[#2563EB]/[0.06] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2563EB] hover:bg-[#2563EB]/[0.12]"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={clearInvestmentWorkingSet}
              title="Clear saved records, private notes, pinned compare areas, and filters from this browser — use before leaving a shared machine."
              className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40 hover:text-[#0C1B33]/70"
            >
              Clear working set
            </button>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/50">
          Flag a row with <span className="font-medium text-[#0C1B33]/70">Save</span> in the Top recipients table to
          build a shortlist. Add a note to each, then export the exact selection as CSV for a meeting.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((r) => (
            <li key={r.id} className="border border-[#0C1B33]/10 bg-white p-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-[#0C1B33]">{r.recipient}</span>
                  <span className="ml-2 text-[11px] text-[#0C1B33]/45">
                    {SOURCE_LABELS_SHORT[r.source as InvestmentSource] ?? r.source}
                    {r.year != null ? ` · ${r.year}` : ""} · {r.communityArea}
                  </span>
                </div>
                <span className="shrink-0 text-[13px] font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
                  {formatFullDollars(r.amountAwarded)}
                </span>
              </div>
              <textarea
                defaultValue={r.notes}
                onBlur={(e) => setShortlistNote(r.id, e.target.value)}
                placeholder="Meeting note…"
                rows={2}
                className="mt-2 w-full resize-y rounded-[3px] border border-[#0C1B33]/12 bg-[#FAF9F6] px-2.5 py-1.5 text-[12px] text-[#0C1B33] placeholder:text-[#0C1B33]/35 focus:border-[#2563EB] focus:outline-none"
              />
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeShortlistRecord(r.id)}
                  className="font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40 hover:text-[#B91C1C]"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
