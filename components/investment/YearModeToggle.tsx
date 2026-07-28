"use client";

import { useState } from "react";

/**
 * Amount / count toggle for the year-trend chart (Sol #4). A thin client shell:
 * both readings are rendered on the server as YearBars instances and passed in as
 * `amount` and `count`; this just swaps which one is visible and paints the
 * segmented control. Keeping the charts server-rendered means no chart engine
 * ships to the client and the SSR/print output still contains the amount reading.
 */
export function YearModeToggle({ amount, count }: { amount: React.ReactNode; count: React.ReactNode }) {
  const [mode, setMode] = useState<"amount" | "count">("amount");

  const seg = (value: "amount" | "count", label: string) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => setMode(value)}
        aria-pressed={active}
        className={`px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] transition-colors ${
          active ? "bg-[#0C1B33] text-white" : "bg-white text-[#0C1B33]/55 hover:text-[#0C1B33]"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <div className="inline-flex overflow-hidden rounded-[3px] border border-[#0C1B33]/15">
          {seg("amount", "Dollars")}
          {seg("count", "Count")}
        </div>
      </div>
      <div className={mode === "amount" ? "" : "hidden"}>{amount}</div>
      <div className={mode === "count" ? "" : "hidden"}>{count}</div>
    </div>
  );
}
