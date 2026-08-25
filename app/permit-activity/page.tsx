import type { Metadata } from "next";
import { CHICAGO_COMMUNITY_AREAS } from "@/lib/community-areas";
import { neighborhoodSlug } from "@/lib/neighborhood-slugs";
import { PermitActivityNeighborhoodPicker } from "./PermitActivityNeighborhoodPicker";

export const metadata: Metadata = {
  title: "Choose a Neighborhood — Permit Activity Analysis",
  description:
    "Choose a Chicago community area before opening its source-backed Permit Activity Analysis.",
};

const neighborhoods = CHICAGO_COMMUNITY_AREAS.map((area) => ({
  name: area.name,
  slug: neighborhoodSlug(area),
})).sort((a, b) => a.name.localeCompare(b.name));

export default function PermitActivityLandingPage() {
  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#0C1B33]">
      <section className="border-b border-[#0C1B33]/10 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-14 sm:px-8 sm:py-20">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#2563EB]">
            Permit Activity Analysis · Neighborhood selection
          </span>
          <h1 className="mt-5 max-w-3xl font-editorial text-[44px] leading-[1.02] sm:text-[62px]">
            What neighborhood do you want to view?
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-7 text-[#0C1B33]/52">
            Choose one of Chicago&apos;s 77 official community areas. We&apos;ll open the permit activity
            analysis for that neighborhood instead of assuming a default location.
          </p>
        </div>
      </section>

      <section className="px-6 py-12 sm:px-8 sm:py-16">
        <div className="mx-auto max-w-2xl border border-[#0C1B33]/10 bg-white p-6 shadow-[0_20px_60px_rgba(12,27,51,0.06)] sm:p-9">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#0C1B33]/35">
            Step 1 · Choose an area
          </span>
          <h2 className="mt-3 font-editorial text-[32px] leading-tight sm:text-[38px]">
            Select a Chicago community area
          </h2>
          <p className="mt-3 text-[13px] leading-6 text-[#0C1B33]/48">
            You can change neighborhoods from inside the analysis at any time.
          </p>
          <div className="mt-7">
            <PermitActivityNeighborhoodPicker neighborhoods={neighborhoods} />
          </div>
        </div>
      </section>
    </div>
  );
}
