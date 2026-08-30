"use client";

import dynamic from "next/dynamic";
import type { ReportZoningMapProps } from "@/components/report/ReportZoningMap";

const ReportZoningMap = dynamic(
  () => import("@/components/report/ReportZoningMap"),
  {
    loading: () => (
      <div className="relative min-h-[420px] w-full border border-[#0C1B33]/10 bg-[#F0F1EE]">
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#0C1B33]/30">
            Loading Chicago zoning data
          </span>
        </div>
      </div>
    ),
  },
);

export default function ReportZoningMapIsland(
  props: ReportZoningMapProps,
) {
  return <ReportZoningMap {...props} />;
}
