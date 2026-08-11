"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCount, formatFullDollars, MAGNITUDE_HUE } from "@/components/investment/format";
import { PinButton } from "@/components/investment/PinControls";

/**
 * The 77-community ranked list with a type-to-filter box.
 *
 * The ranking is the landing page's navigation primitive — the battle-test's
 * one unanimous "promote" — but 77 rows moved to the top are still 77 rows.
 * The filter narrows by name; it never re-ranks. Each row keeps its ORIGINAL
 * rank number while filtered so "Austin — #4" stays true no matter what subset
 * is on screen, and the visible "N of 77" line states that a subset is a
 * subset (a filtered list that looks complete would misstate coverage).
 */
export interface CommunityRankingRow {
  communityArea: string;
  totalAwarded: number;
  recordCount: number;
}

export function CommunityRankingList({ rows }: { rows: CommunityRankingRow[] }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const maxAwarded = rows.length > 0 ? rows[0].totalAwarded : 0;
  const ranked = rows.map((row, i) => ({ ...row, rank: i + 1 }));
  const visible = trimmed
    ? ranked.filter((r) => r.communityArea.toLowerCase().includes(trimmed))
    : ranked;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by community name…"
          aria-label="Filter communities by name"
          className="w-full max-w-[280px] border border-[#0C1B33]/15 bg-white px-3 py-1.5 text-[13px] text-[#0C1B33] placeholder:text-[#0C1B33]/35 focus:border-[#2563EB] focus:outline-none"
        />
        <span className="shrink-0 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
          {trimmed ? `${visible.length} of ${rows.length} shown` : "Ranked high → low"}
        </span>
      </div>
      <div className="divide-y divide-[#0C1B33]/8 border border-[#0C1B33]/10 bg-white">
        {visible.map((row) => {
          const pct = maxAwarded > 0 ? row.totalAwarded / maxAwarded : 0;
          return (
            <div key={row.communityArea} className="flex items-center gap-2 pr-3 sm:pr-4">
              <Link
                href={`/investment/${encodeURIComponent(row.communityArea)}`}
                className="group flex min-w-0 flex-1 items-center gap-4 px-4 py-3 transition-colors hover:bg-[#FAF9F6] sm:px-5"
              >
                <span className="w-7 shrink-0 text-right font-mono-bureau text-[12px] text-[#0C1B33]/35 [font-variant-numeric:tabular-nums]">
                  {row.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[14px] font-medium text-[#0C1B33] group-hover:text-[#2563EB]">
                      {row.communityArea}
                    </span>
                    <span className="shrink-0 text-[14px] font-semibold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
                      {formatFullDollars(row.totalAwarded)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#0C1B33]/[0.06]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          // Honest linear width — no shared floor that would render a
                          // >100x dollar spread as identical bars; 1px minWidth only keeps
                          // a nonzero value from vanishing entirely (the $ text is the read).
                          width: `${pct * 100}%`,
                          minWidth: row.totalAwarded > 0 ? "1px" : 0,
                          backgroundColor: MAGNITUDE_HUE,
                        }}
                      />
                    </div>
                    <span className="shrink-0 font-mono-bureau text-[10px] uppercase tracking-[0.08em] text-[#0C1B33]/40">
                      {formatCount(row.recordCount)} record{row.recordCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </Link>
              <PinButton area={row.communityArea} />
            </div>
          );
        })}
        {visible.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-[#0C1B33]/50">
            No community matches &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : null}
      </div>
    </div>
  );
}
